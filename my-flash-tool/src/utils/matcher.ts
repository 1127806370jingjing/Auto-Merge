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
    log?: string; // 👈 新增：用于存储具体的成功或失败信息
  }
  
  // 分词工具
  const tokenize = (filename: string) => {
    return filename.toLowerCase()
      .replace(/\.[^/.]+$/, "") 
      .split(/[-_.\s]+/)        
      .filter(w => w.length > 1 && !['boot', 'app', 'bin', 'hex', 'v'].includes(w)); 
  };
  
  export const autoMatchFiles = (bootFiles: FileEntry[], appFiles: FileEntry[]): FilePair[] => {
    const pairs: FilePair[] = [];
    const usedAppIndices = new Set<number>();
  
    bootFiles.forEach(boot => {
      const bootTokens = tokenize(boot.name);
      let bestMatchIndex = -1;
      let maxScore = 0;
  
      appFiles.forEach((app, index) => {
        if (usedAppIndices.has(index)) return; 
  
        const appTokens = tokenize(app.name);
        
        let matchCount = 0;
        bootTokens.forEach(bt => {
          if (appTokens.includes(bt)) matchCount++;
        });
  
        if (matchCount > maxScore) {
          maxScore = matchCount;
          bestMatchIndex = index;
        }
      });
  
      if (bestMatchIndex !== -1 && maxScore > 0) {
        const bestApp = appFiles[bestMatchIndex];
        usedAppIndices.add(bestMatchIndex);
  
        const outName = bestApp.name.replace(/\.[^/.]+$/, "") + "_Merged.hex";
  
        pairs.push({
          id: crypto.randomUUID(),
          boot: boot,
          app: bestApp,
          outName: outName,
          status: 'pending',
          log: '' // 👈 初始化为空
        });
      }
    });
  
    return pairs;
  };