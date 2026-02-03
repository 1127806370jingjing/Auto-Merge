export interface FileEntry {
    name: string;
    path: string;
  }
  
  export interface FilePair {
    id: string;
    boot: FileEntry;
    app: FileEntry;
    outName: string;
    status: 'pending' | 'success' | 'error';
    log?: string;
    materialCode: string;
  }
  
  export interface MatchResult {
    isMatch: boolean;
    reason: string; // 成功或失败的具体原因
    commonTokens: string[];
  }
  
  // 🚫 噪音词典：这些词不参与核心匹配逻辑
  const IGNORED_KEYWORDS = [
    'boot', 'bootloader', 'app', 'application', 'bin', 'hex', 
    'v', 'ver', 'version', 'release', 'debug', 'firmware',
    'sign', 'signed', 'merge', 'merged', 'test',
    'hpm', 'address', 'addr', 'offset', '0x'
  ];
  
  // 🛠️ 分词工具
  const tokenize = (filename: string): string[] => {
    return filename.toLowerCase()
      .replace(/\.[^/.]+$/, "") 
      .split(/[-_.\s]+/)        
      .filter(w => {
        if (w.length < 2) return false;
        if (IGNORED_KEYWORDS.includes(w)) return false;
        // 过滤纯十六进制地址 (如 0x219d)
        if (w.startsWith('0x') && w.length > 4) return false;
        return true;
      }); 
  };
  
  // 🧠 核心验证函数：冲突检测
  export const verifyFileNameMatch = (bootName: string, appName: string): MatchResult => {
    const bootTokens = tokenize(bootName);
    const appTokens = tokenize(appName);
    
    // 1. 提取共同特征
    const commonTokens = bootTokens.filter(t => appTokens.includes(t));
  
    // --- 🛡️ 安全检查 1: 型号冲突检测 (Model Conflict) ---
    // 假设型号通常以字母开头后跟数字 (如 RS6, RS7, SC4015)
    // 或者是特定的英文系列名 (如 Air, Pro, Ultra, Plus)
    const isModelToken = (t: string) => /^[a-z]+[0-9]+$/.test(t) || ['air', 'pro', 'ultra', 'plus', 'max' ,'Turbo'].includes(t);
    
    const bootModels = bootTokens.filter(isModelToken);
    const appModels = appTokens.filter(isModelToken);
  
    // 如果双方都包含型号词，但完全没有交集 -> 判定为型号不符
    // 例如：Boot=[rs7, air] vs App=[rs6, air] -> air 相同但 rs7!=rs6 -> 危险
    // 逻辑：如果一方有 RS7，另一方必须也有 RS7，否则报错
    for (const m of bootModels) {
      // 如果 App 也有型号词，但没有这个词，且有其他互斥的型号词
      if (!appTokens.includes(m)) {
        // 检查 App 是否有其他类似的型号词 (比如 Boot是RS7，App里有RS6)
        const hasConflictingModel = appModels.some(am => am.startsWith(m.substring(0, 2))); // 简单前缀比对
        if (hasConflictingModel || appModels.length > 0) {
           // 这里比较严格：只要 Boot 里有的型号词，App 里没有，就视为风险
           // 但为了防止误判 (比如 Boot 叫 RS7_Pro, App 叫 RS7)，我们只在有显性冲突时报错
           // 简化策略：找出双方都有的“系列前缀”，如果数字不同则报错
        }
      }
    }
    
    // 简化版型号检测：如果双方都提取出了型号 (如 RS7 vs RS6)，必须完全一致
    const bootMainModel = bootModels.find(t => t.startsWith('rs') || t.startsWith('sc') || t.startsWith('vk'));
    const appMainModel = appModels.find(t => t.startsWith('rs') || t.startsWith('sc') || t.startsWith('vk'));
    
    if (bootMainModel && appMainModel && bootMainModel !== appMainModel) {
      return { isMatch: false, reason: `型号冲突: Boot是 ${bootMainModel.toUpperCase()}，App是 ${appMainModel.toUpperCase()}`, commonTokens };
    }
  
    // --- 🛡️ 安全检查 2: 轴体冲突检测 (Switch Conflict - 中文匹配) ---
    const isChinese = (t: string) => /[\u4e00-\u9fa5]/.test(t); // 检测中文
    const bootChinese = bootTokens.filter(isChinese);
    const appChinese = appTokens.filter(isChinese);
  
    // 如果 Boot 指定了轴体 (有中文)，App 也指定了轴体，但两者完全没交集 -> 报错
    // 例如：Boot="冰刃轴", App="乾元轴" -> 冲突
    if (bootChinese.length > 0 && appChinese.length > 0) {
      const hasCommonChinese = bootChinese.some(bc => appChinese.includes(bc));
      if (!hasCommonChinese) {
        return { 
          isMatch: false, 
          reason: `轴体/版本不符: [${bootChinese.join(',')}] vs [${appChinese.join(',')}]`, 
          commonTokens 
        };
      }
    }
  
    // --- ✅ 最终通过标准 ---
    // 1. 必须有共同关键词
    if (commonTokens.length === 0) {
      return { isMatch: false, reason: "文件名无任何关联", commonTokens };
    }
  
    // 2. 如果包含“Air”、“Pro”等关键修饰词，必须双方都有
    const criticalModifiers = ['air', 'pro', 'ultra', 'plus'];
    for (const mod of criticalModifiers) {
      if (bootTokens.includes(mod) && !appTokens.includes(mod)) {
        return { isMatch: false, reason: `Boot 是 ${mod} 版本，但 App 不是`, commonTokens };
      }
      if (!bootTokens.includes(mod) && appTokens.includes(mod)) {
        return { isMatch: false, reason: `App 是 ${mod} 版本，但 Boot 不是`, commonTokens };
      }
    }
  
    return { isMatch: true, reason: "匹配成功", commonTokens };
  };
  
  // 3. 批量匹配逻辑 (适配新返回值)
  export const autoMatchFiles = (bootFiles: FileEntry[], appFiles: FileEntry[]): FilePair[] => {
    const pairs: FilePair[] = [];
    const usedAppIndices = new Set<number>();
  
    bootFiles.forEach(boot => {
      let bestMatchIndex = -1;
      let maxScore = 0;
  
      appFiles.forEach((app, index) => {
        if (usedAppIndices.has(index)) return; 
        
        const { isMatch, commonTokens } = verifyFileNameMatch(boot.name, app.name);
        
        if (isMatch) {
          // 分数计算：共同词数量 + 是否包含中文(权重加倍)
          let score = commonTokens.length;
          if (commonTokens.some(t => /[\u4e00-\u9fa5]/.test(t))) score += 2;
  
          if (score > maxScore) {
            maxScore = score;
            bestMatchIndex = index;
          }
        }
      });
  
      if (bestMatchIndex !== -1) {
        const bestApp = appFiles[bestMatchIndex];
        usedAppIndices.add(bestMatchIndex);
        const outName = bestApp.name.replace(/\.[^/.]+$/, "") + ".hex";
        pairs.push({
          id: crypto.randomUUID(), boot: boot, app: bestApp,
          outName: outName, status: 'pending', log: '', materialCode: ''
        });
      }
    });
    return pairs;
  };