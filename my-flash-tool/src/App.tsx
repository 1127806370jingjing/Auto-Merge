import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import { readDir } from '@tauri-apps/plugin-fs';
import { load } from '@tauri-apps/plugin-store';
import { 
  Settings, Layers, Zap, CheckCircle2, XCircle, Loader2, Cpu, FileCog, 
  Sparkles, ArrowRight, FolderOutput, FolderOpen, Hash, Unlink, 
  Usb, RefreshCw, Flame, ChevronDown, ChevronUp, HelpCircle, Copy
} from 'lucide-react';
import clsx from 'clsx';
import { autoMatchFiles, FilePair, verifyFileNameMatch } from './utils/matcher';

const getStore = async () => await load('settings.json');

/** 从 HEX 路径/文件名中提取十六进制关键词（0x 开头、_XXXX_ / XXXX. 或 XXXX.hex），用于在 HID 列表中高亮对应设备 */
function extractHexKeywords(pathOrName: string): string[] {
  const out = new Set<string>();
  (pathOrName.match(/0x[0-9a-fA-F]+/g) || []).forEach(m => out.add(m.toLowerCase()));
  const iter = pathOrName.matchAll(/(?:^|_|\-)([0-9a-fA-F]{4})(?=_|\-|\.|$|\s)/g);
  for (const m of iter) if (m[1]) out.add('0x' + m[1].toLowerCase());
  for (const m of pathOrName.matchAll(/([0-9a-fA-F]{4})\.hex/gi)) if (m[1]) out.add('0x' + m[1].toLowerCase());
  return [...out];
}

function hidDeviceKey(dev: { vid: number; pid: number; serial_number?: string }) {
  return `${dev.vid}-${dev.pid}-${dev.serial_number ?? ''}`;
}

function isHidHighlight(dev: { vid: number; pid: number }, keywords: string[]): boolean {
  if (!keywords.length) return false;
  const vidHex = '0x' + Number(dev.vid).toString(16).toLowerCase().padStart(4, '0');
  const pidHex = '0x' + Number(dev.pid).toString(16).toLowerCase().padStart(4, '0');
  return keywords.includes(vidHex) || keywords.includes(pidHex);
}

/** 设备名包含 Upgrade 视为 BOOT 模式 */
function isBootModeDevice(dev: { product?: string }): boolean {
  const name = (dev.product ?? '').toLowerCase();
  return name.includes('upgrade');
}

// --- 🍬 UI 组件库 ---

const NavButton = ({ active, onClick, icon: Icon, label }: any) => (
  <button 
    onClick={onClick}
    className={clsx(
      "flex flex-col items-center justify-center w-full aspect-square rounded-2xl transition-all duration-300 group",
      active ? "bg-white text-blue-500 shadow-md shadow-blue-100 scale-100" : "text-slate-400 hover:bg-white/60 hover:text-slate-600 hover:scale-95"
    )}
  >
    <Icon size={24} className={clsx("mb-1 transition-transform group-hover:-translate-y-1", active && "text-blue-500")} />
    <span className="text-[10px] font-bold">{label}</span>
  </button>
);

const GlassCard = ({ children, className }: any) => (
  <div className={clsx("bg-white/80 backdrop-blur-xl border border-white/60 shadow-lg shadow-slate-200/50 rounded-[2rem]", className)}>
    {children}
  </div>
);

/** 若路径像是文件（带扩展名）则返回其所在目录，否则返回原路径（用于在资源管理器中打开） */
function pathToOpenInExplorer(path: string): string {
  if (!path) return path;
  if (/\.(bin|hex|exe|jflash|[\w]+)$/i.test(path.trim())) return path.replace(/[/\\][^/\\]+$/, '') || path;
  return path;
}

const CleanInput = ({ label, value, onClick, onChange, icon: Icon, placeholder = "点击选择...", readOnly = true, rightElement, pathToOpen }: any) => (
  <div className="w-full">
    <div className="flex items-center justify-between px-1 mb-1.5 gap-2">
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 shrink-0">
        <div className="w-1 h-3 bg-blue-400 rounded-full"></div>
        {label}
      </label>
      <div className="flex items-center gap-1.5 shrink-0">
        {pathToOpen && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); openPath(pathToOpenInExplorer(pathToOpen)); }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
            title="在资源管理器中打开"
          >
            <FolderOpen size={14} />
          </button>
        )}
        {rightElement}
      </div>
    </div>
    <div 
      onClick={!readOnly ? undefined : onClick}
      className={clsx(
        "group relative flex items-center gap-3 bg-slate-50 border border-slate-100 hover:bg-white hover:border-blue-200 hover:shadow-md rounded-2xl p-3 transition-all duration-300 cursor-pointer",
        !readOnly && "cursor-text bg-white border-blue-100 ring-2 ring-blue-50"
      )}
    >
      <div className="p-2 bg-white rounded-xl shadow-sm text-slate-400 group-hover:text-blue-500 transition-colors">
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        {readOnly ? (
          <div className="text-sm font-bold text-slate-600 truncate font-mono" title={value}>
            {value ? value.split(/[/\\]/).pop() : <span className="text-slate-300 font-sans italic font-normal">{placeholder}</span>}
          </div>
        ) : (
          <input 
            value={value} onChange={onChange} placeholder={placeholder}
            className="w-full text-sm font-bold text-slate-600 font-mono bg-transparent outline-none placeholder:text-slate-300 placeholder:font-sans placeholder:italic"
          />
        )}
      </div>
    </div>
  </div>
);

// --- 主程序 ---

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  
  // Config
  const [jflashExe, setJflashExe] = useState('');
  const [jflashPrj, setJflashPrj] = useState('');
  const [bootAddr, setBootAddr] = useState('0x08000000');
  const [appAddr, setAppAddr] = useState('0x08020000');

  // Single Mode
  const [bootPath, setBootPath] = useState('');
  const [appPath, setAppPath] = useState('');
  const [outDir, setOutDir] = useState('');
  const [materialCode, setMaterialCode] = useState('');
  const [matchStatus, setMatchStatus] = useState<'idle' | 'matched' | 'mismatch'>('idle'); 
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [log, setLog] = useState('');
  const [generatedHex, setGeneratedHex] = useState(''); // 记录上次生成的 Hex 路径用于验证

  // Batch Mode
  const [batchBootDir, setBatchBootDir] = useState('');
  const [batchAppDir, setBatchAppDir] = useState('');
  const [batchOutDir, setBatchOutDir] = useState('');
  const [batchPairs, setBatchPairs] = useState<FilePair[]>([]);
  const [batchStatus, setBatchStatus] = useState<'idle' | 'running' | 'done'>('idle');
  const [processedCount, setProcessedCount] = useState(0);

  // HID Info
  const [hidDevices, setHidDevices] = useState<any[]>([]);
  const [hidLoading, setHidLoading] = useState(false);
  const [deviceVersions, setDeviceVersions] = useState<Record<string, string>>({});
  const versionFetchingRef = useRef<Set<string>>(new Set());
  const [lastFlashedHexKeywords, setLastFlashedHexKeywords] = useState<string[]>([]);
  const [selectedHidKey, setSelectedHidKey] = useState<string | null>(null);
  const [bootSwitchLoading, setBootSwitchLoading] = useState<string | null>(null);
  const [bootSwitchTip, setBootSwitchTip] = useState<string | null>(null);

  // HEX 烧录（左侧列表选择文件夹内 HEX 并烧录）
  const [tab, setTabInner] = useState<'single' | 'batch' | 'hex'>('single');
  const [hexFlashFolder, setHexFlashFolder] = useState('');
  const [hexFileList, setHexFileList] = useState<{ name: string; path: string }[]>([]);
  const [selectedHexPath, setSelectedHexPath] = useState('');
  const [hexFlashStatus, setHexFlashStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [hexFlashLog, setHexFlashLog] = useState('');
  const setTab = (t: 'single' | 'batch' | 'hex') => {
    setTabInner(t);
    if (t === 'hex' && !hexFlashFolder && (outDir || batchOutDir)) setHexFlashFolder(outDir || batchOutDir);
  };

  const runHexFlash = async () => {
    if (!selectedHexPath || !jflashExe || !jflashPrj) return;
    setHexFlashStatus('running'); setHexFlashLog('⏳ 正在烧录...');
    try {
      const res = await invoke<string>('execute_flash_only', { jflashPath: jflashExe, projectPath: jflashPrj, hexPath: selectedHexPath });
      setHexFlashStatus('success'); setHexFlashLog(res);
      setLastFlashedHexKeywords(extractHexKeywords(selectedHexPath));
      refreshHid();
    } catch (e: any) { setHexFlashStatus('error'); setHexFlashLog(String(e)); }
  };

  useEffect(() => { init(); }, []);

  // HID 设备列表自动刷新（每 2 秒，拔插后更快看到）
  useEffect(() => {
    const t = setInterval(refreshHid, 2000);
    return () => clearInterval(t);
  }, []);

  // 切到 HEX 且未选文件夹时，默认用单次/批量输出目录
  useEffect(() => {
    if (tab === 'hex' && !hexFlashFolder && (outDir || batchOutDir)) setHexFlashFolder(outDir || batchOutDir);
  }, [tab, hexFlashFolder, outDir, batchOutDir]);

  // HEX 文件夹变化时刷新 HEX 列表
  useEffect(() => {
    if (tab !== 'hex' || !hexFlashFolder) { setHexFileList([]); return; }
    readDir(hexFlashFolder).then(entries => {
      const hex = entries
        .filter(e => e.name?.toLowerCase().endsWith('.hex'))
        .map(e => ({ name: e.name!, path: `${hexFlashFolder}\\${e.name}` }));
      setHexFileList(hex);
    }).catch(() => setHexFileList([]));
  }, [tab, hexFlashFolder]);

  const init = async () => {
    const s = await getStore();
    setJflashPrj((await s.get<string>('jflash_prj')) || '');
    setBootAddr((await s.get<string>('addr_boot')) || '0x08000000');
    setAppAddr((await s.get<string>('addr_app')) || '0x08020000');
    setOutDir((await s.get<string>('last_out_dir')) || '');
    setBatchOutDir((await s.get<string>('last_batch_out')) || '');
    setHexFlashFolder((await s.get<string>('last_hex_flash_dir')) || '');
    const exe = await s.get<string>('jflash_exe');
    if (exe) setJflashExe(exe); else invoke<string>('auto_detect_jflash').then(p => { setJflashExe(p); s.set('jflash_exe', p).then(()=>s.save())});
    
    refreshHid();
  };

  const refreshHid = async () => {
    setHidLoading(true);
    try {
      const devs = await invoke<any[]>('scan_hid_devices');
      setHidDevices(devs);
    } catch(e) { console.error(e); }
    setHidLoading(false);
  };

  // HID 列表变化后自动为每个设备获取版本（已有版本或正在请求的跳过）；仅成功时写入，无法获取的不显示
  useEffect(() => {
    if (!hidDevices.length) return;
    hidDevices.forEach((dev) => {
      const key = hidDeviceKey(dev);
      if (deviceVersions[key] !== undefined || versionFetchingRef.current.has(key)) return;
      versionFetchingRef.current.add(key);
      invoke<string>('get_hid_device_version', {
        vid: dev.vid,
        pid: dev.pid,
        serial: dev.serial_number || null,
        usagePage: dev.usage_page ?? null
      })
        .then((v) => setDeviceVersions(prev => ({ ...prev, [key]: v })))
        .catch(() => {})
        .finally(() => { versionFetchingRef.current.delete(key); });
    });
  }, [hidDevices]);

  // --- Logic: Matcher & Path ---
  useEffect(() => {
    if (!bootPath || !appPath) { setMatchStatus('idle'); setLog("等待文件选择..."); return; }
    const sep = bootPath.includes('\\') ? '\\' : '/';
    const { isMatch, commonTokens, reason } = verifyFileNameMatch(bootPath.split(sep).pop()!, appPath.split(sep).pop()!);
    if (isMatch) {
      setMatchStatus('matched');
      setLog(`✅ 匹配成功 (${commonTokens.join(', ')})`);
    } else {
      setMatchStatus('mismatch');
      setLog(`❌ 文件不匹配: ${reason}`);
    }
  }, [bootPath, appPath]);

  const getPreviewPath = () => {
    if (!appPath) return '';
    const sep = appPath.includes('\\') ? '\\' : '/';
    const dir = outDir || appPath.substring(0, appPath.lastIndexOf(sep));
    const name = appPath.split(sep).pop()!.replace(/\.[^/.]+$/, "");
    const prefix = materialCode ? `${materialCode}_` : '';
    return `${dir}${dir.endsWith(sep)?'':sep}${prefix}${name}_Merged.hex`;
  };

  // --- Handlers ---
  const handleSelect = async (key: string, isDir = false) => {
    if (key.includes('dir') || key.includes('out') || isDir || key === 'hex_folder') {
      const p = await open({ directory: true });
      if (p && typeof p === 'string') {
        const s = await getStore();
        if (key === 'out_dir') { setOutDir(p); s.set('last_out_dir', p); }
        if (key === 'batch_out') { setBatchOutDir(p); s.set('last_batch_out', p); }
        if (key === 'b_boot') setBatchBootDir(p);
        if (key === 'b_app') setBatchAppDir(p);
        if (key === 'hex_folder') { setHexFlashFolder(p); s.set('last_hex_flash_dir', p); }
        s.save();
      }
      return;
    }
    const res = await open({ filters: [{ name: 'Files', extensions: ['exe', 'jflash', 'bin', 'hex'] }] });
    if (typeof res === 'string') {
      const s = await getStore();
      if (key === 'boot') setBootPath(res);
      if (key === 'app') setAppPath(res);
      if (key === 'exe') { setJflashExe(res); s.set('jflash_exe', res); }
      if (key === 'prj') { setJflashPrj(res); s.set('jflash_prj', res); }
      s.save();
    }
  };

  // ▶️ 1. 单文件合并
  const runMerge = async () => {
    if (matchStatus !== 'matched') return;
    const finalPath = getPreviewPath();
    setStatus('running'); setLog('⏳ 正在合并 HEX 文件...');
    try {
      await invoke('execute_merge_and_flash', {
        jflashPath: jflashExe, projectPath: jflashPrj,
        bootPath, appPath, outputPath: finalPath, bootAddr, appAddr, onlyMerge: true
      });
      setStatus('success'); setLog(`✅ 合并成功！`); setGeneratedHex(finalPath);
    } catch (e: any) { setStatus('error'); setLog(`❌ ${e}`); }
  };

  // 🔥 2. 独立烧录验证
  const runVerifyFlash = async () => {
    if (!generatedHex) return;
    setStatus('running'); setLog('🔌 正在连接 J-Link 并执行烧录 (Erase + Program)...');
    try {
      const res = await invoke<string>('execute_flash_only', {
        jflashPath: jflashExe, projectPath: jflashPrj, hexPath: generatedHex
      });
      setStatus('success'); setLog(res);
      setLastFlashedHexKeywords(extractHexKeywords(generatedHex));
      refreshHid();
    } catch (e: any) { setStatus('error'); setLog(`❌ ${e}`); }
  };

  useEffect(() => { if (batchBootDir && batchAppDir) scanBatch(); }, [batchBootDir, batchAppDir]);
  const scanBatch = async () => {
    try {
      const bFiles = (await readDir(batchBootDir)).filter(e => e.name?.toLowerCase().endsWith('.bin') || e.name?.toLowerCase().endsWith('.hex')).map(e => ({ name: e.name, path: `${batchBootDir}\\${e.name}` }));
      const aFiles = (await readDir(batchAppDir)).filter(e => e.name?.toLowerCase().endsWith('.bin') || e.name?.toLowerCase().endsWith('.hex')).map(e => ({ name: e.name, path: `${batchAppDir}\\${e.name}` }));
      setBatchPairs(autoMatchFiles(bFiles, aFiles));
    } catch (e) {}
  };

  const setBatchPairMaterialCode = (id: string, materialCode: string) => {
    setBatchPairs(prev => prev.map(p => p.id === id ? { ...p, materialCode } : p));
  };

  const runBatchMerge = async () => {
    if (!jflashExe || !jflashPrj || batchPairs.length === 0) return;
    const outRoot = batchOutDir || `${batchAppDir}\\Merged_Output`;
    setBatchStatus('running');
    setProcessedCount(0);
    const next = [...batchPairs];
    for (let i = 0; i < next.length; i++) {
      const p = next[i];
      const prefix = p.materialCode.trim() ? `${p.materialCode.trim()}_` : '';
      const outPath = `${outRoot}\\${prefix}${p.outName}`;
      try {
        await invoke('execute_merge_and_flash', {
          jflashPath: jflashExe, projectPath: jflashPrj,
          bootPath: p.boot.path, appPath: p.app.path, outputPath: outPath,
          bootAddr, appAddr, onlyMerge: true
        });
        next[i] = { ...p, status: 'success', log: '✅' };
      } catch (e: any) {
        next[i] = { ...p, status: 'error', log: `❌ ${String(e).slice(0, 80)}` };
      }
      setBatchPairs([...next]);
      setProcessedCount(i + 1);
    }
    setBatchStatus('done');
  };

  return (
    <div className="h-screen w-screen bg-[#f2f4f8] text-slate-600 font-sans flex overflow-hidden selection:bg-blue-100">
      
      {/* 🔮 侧边栏 */}
      <aside className="w-24 bg-slate-100/50 backdrop-blur flex flex-col items-center py-8 gap-6 z-20 border-r border-white">
        <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-2xl shadow-lg shadow-blue-200 flex items-center justify-center mb-4">
          <Cpu className="text-white" size={24} />
        </div>
        <div className="flex flex-col gap-4 w-16">
          <NavButton active={tab === 'single'} onClick={() => setTab('single')} icon={Zap} label="合并" />
          <NavButton active={tab === 'batch'} onClick={() => setTab('batch')} icon={Layers} label="批量" />
          <NavButton active={tab === 'hex'} onClick={() => setTab('hex')} icon={Flame} label="HEX烧录" />
        </div>
        <div className="mt-auto flex flex-col gap-4">
          <NavButton onClick={() => setShowHelp(true)} icon={HelpCircle} label="使用说明" />
          <NavButton onClick={() => setShowSettings(true)} icon={Settings} label="设置" />
        </div>
      </aside>

      {/* 🚀 主内容区 */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#f8fafc] relative">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:20px_20px] opacity-50 pointer-events-none"></div>
        
        {/* 顶部标题 */}
        <header className="px-10 py-8 z-10">
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">
            {tab === 'single' ? 'Single Merge & Verify' : tab === 'batch' ? 'Batch Processor' : 'HEX 烧录'}
          </h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Auto-Merge</p>
        </header>

        <div className="flex-1 px-10 pb-10 overflow-hidden flex gap-8 z-10">
          
          {/* 左侧：操作卡片 (自适应宽度) */}
          <div className="flex-1 flex flex-col min-w-0 h-full">
            {tab === 'hex' ? (
              <GlassCard className="h-full p-8 flex flex-col gap-6">
                <CleanInput label="HEX 所在文件夹" value={hexFlashFolder} onClick={() => handleSelect('hex_folder')} icon={FolderOpen} placeholder="默认：单次/批量输出目录，可手动选择" />
                <div className="flex-1 min-h-0 flex flex-col rounded-2xl border border-slate-200 bg-slate-50/80 overflow-hidden">
                  <div className="px-3 py-2 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase">选择 HEX 文件</div>
                  <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                    {!hexFlashFolder && <div className="p-6 text-center text-slate-400 text-sm">请先选择文件夹</div>}
                    {hexFlashFolder && hexFileList.length === 0 && <div className="p-6 text-center text-slate-400 text-sm">该目录下无 .hex 文件</div>}
                    {hexFileList.map(f => (
                      <button
                        key={f.path}
                        onClick={() => setSelectedHexPath(f.path)}
                        className={clsx("w-full text-left px-4 py-3 font-mono text-sm transition-colors", selectedHexPath === f.path ? "bg-blue-100 text-blue-700 border-l-4 border-blue-500" : "hover:bg-slate-100 text-slate-600")}
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={clsx("rounded-2xl border p-4 font-mono text-xs whitespace-pre-wrap", hexFlashStatus === 'error' ? "bg-red-50 text-red-600 border-red-100" : "bg-slate-50 text-slate-600 border-slate-100")}>
                  {hexFlashStatus === 'running' && <Loader2 className="animate-spin inline-block mr-2" size={14} />}
                  {hexFlashLog || (selectedHexPath ? `已选: ${selectedHexPath.split(/[/\\]/).pop()}` : '在列表中点击一个 HEX 后点击烧录')}
                </div>
                <button
                  onClick={runHexFlash}
                  disabled={hexFlashStatus === 'running' || !selectedHexPath || !jflashExe || !jflashPrj}
                  className={clsx("h-14 rounded-2xl font-bold text-white shadow-xl flex items-center justify-center gap-2 transition-all", (!selectedHexPath || hexFlashStatus === 'running') ? "bg-slate-300 cursor-not-allowed" : "bg-gradient-to-r from-orange-500 to-rose-500 hover:scale-[1.02] active:scale-95")}
                >
                  <Flame size={20} /> 烧录选中 HEX
                </button>
              </GlassCard>
            ) : tab === 'single' ? (
              <GlassCard className="h-full p-8 flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-300">
                {/* 文件选择 */}
                <div className="space-y-4">
                  <CleanInput label="Bootloader" value={bootPath} onClick={() => handleSelect('boot')} icon={Layers} pathToOpen={bootPath}
                    rightElement={matchStatus === 'matched' ? <CheckCircle2 className="text-emerald-500" size={16}/> : matchStatus === 'mismatch' ? <Unlink className="text-red-500" size={16}/> : null} />
                  
                  <div className="flex justify-center -my-2 opacity-20"><ArrowRight className="rotate-90" /></div>
                  
                  <CleanInput label="Application" value={appPath} onClick={() => handleSelect('app')} icon={Zap} pathToOpen={appPath}
                    rightElement={matchStatus === 'matched' ? <CheckCircle2 className="text-emerald-500" size={16}/> : matchStatus === 'mismatch' ? <Unlink className="text-red-500" size={16}/> : null} />
                </div>

                {/* 配置区 */}
                <div className="grid grid-cols-2 gap-4">
                  <CleanInput label="物料号 (前缀)" value={materialCode} onChange={(e:any) => setMaterialCode(e.target.value)} readOnly={false} icon={Hash} placeholder="例如 2211..." />
                  <CleanInput label="输出目录" value={getPreviewPath()} onClick={() => handleSelect('out_dir')} icon={FolderOutput} placeholder="默认同级" pathToOpen={outDir || (appPath ? appPath.replace(/[/\\][^/\\]+$/, '') : '')} />
                </div>

                {/* 状态反馈 */}
                <div className={clsx("flex-1 rounded-2xl border p-4 font-mono text-xs whitespace-pre-wrap transition-colors", 
                  status === 'error' ? "bg-red-50 text-red-500 border-red-100" : "bg-slate-50 text-slate-500 border-slate-100"
                )}>
                  {status === 'running' && <Loader2 className="animate-spin mb-2" />}
                  {log}
                </div>

                {/* 底部按钮组 */}
                <div className="flex gap-4 mt-auto">
                  <button 
                    onClick={runMerge}
                    disabled={status === 'running' || matchStatus !== 'matched'}
                    className={clsx("flex-1 h-14 rounded-2xl font-bold text-white shadow-xl transition-all flex items-center justify-center gap-2",
                      matchStatus !== 'matched' ? "bg-slate-300 cursor-not-allowed" : "bg-gradient-to-r from-blue-500 to-indigo-600 hover:scale-[1.02] active:scale-95"
                    )}
                  >
                    <Sparkles size={18} /> 合并生成 HEX
                  </button>

                  {/* 🔥 烧录验证按钮 (仅当有生成文件时显示) */}
                  {generatedHex && (
                    <button 
                      onClick={runVerifyFlash}
                      className="flex-1 h-14 rounded-2xl font-bold text-white shadow-xl bg-gradient-to-r from-orange-400 to-pink-500 hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2 animate-in slide-in-from-bottom-2"
                    >
                      <Flame size={18} /> 烧录验证 (Verify)
                    </button>
                  )}
                </div>
              </GlassCard>
            ) : (
              // 批量合并 - 亮色二次元主题
              <div className="h-full flex flex-col gap-5 p-6">
                <div className="rounded-[2rem] border-2 border-pink-200/80 bg-gradient-to-br from-white via-rose-50/50 to-pink-50/50 shadow-lg shadow-pink-100/50 p-6 flex flex-col flex-1 min-h-0">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-2xl">✨</span>
                    <h2 className="text-lg font-black text-rose-700 tracking-tight">批量 Merge</h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                    <CleanInput label="Boot 目录" value={batchBootDir} onClick={() => handleSelect('b_boot', true)} icon={FolderOpen} placeholder="选择文件夹" pathToOpen={batchBootDir} />
                    <CleanInput label="App 目录" value={batchAppDir} onClick={() => handleSelect('b_app', true)} icon={FolderOpen} placeholder="选择文件夹" pathToOpen={batchAppDir} />
                    <CleanInput label="HEX 输出目录" value={batchOutDir} onClick={() => handleSelect('batch_out')} icon={FolderOutput} placeholder="默认 App/Merged_Output" pathToOpen={batchOutDir} />
                  </div>
                  <div className="flex-1 min-h-0 flex flex-col rounded-2xl border border-pink-200/60 bg-white/70 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2 bg-rose-100/60 border-b border-pink-200/60 text-xs font-bold text-rose-700 uppercase tracking-wider">
                      <span className="w-8">#</span>
                      <span className="flex-1">输出 HEX 文件名</span>
                      <span className="w-36 text-center">物料编号（前缀）</span>
                      <span className="w-14 text-center">状态</span>
                    </div>
                    <div className="flex-1 overflow-y-auto divide-y divide-pink-100/80">
                      {batchPairs.length === 0 && (
                        <div className="h-32 flex items-center justify-center text-pink-300 text-sm">请先选择 Boot 与 App 目录</div>
                      )}
                      {batchPairs.map((p, idx) => (
                        <div key={p.id} className="flex items-center gap-2 px-4 py-2.5 hover:bg-rose-50/50 transition-colors">
                          <span className="w-8 text-sm font-bold text-rose-400">{idx + 1}</span>
                          <span className="flex-1 text-sm font-mono text-slate-600 truncate" title={(p.materialCode.trim() ? p.materialCode.trim() + '_' : '') + p.outName}>
                            {(p.materialCode.trim() ? p.materialCode.trim() + '_' : '') + p.outName}
                          </span>
                          <input
                            value={p.materialCode}
                            onChange={e => setBatchPairMaterialCode(p.id, e.target.value)}
                            placeholder="如 22110510"
                            className="w-36 text-center text-sm font-mono bg-white/90 border border-pink-200 rounded-xl px-2 py-1.5 text-slate-600 placeholder:text-pink-200 focus:ring-2 focus:ring-pink-300 focus:border-pink-300 outline-none"
                          />
                          <span className={clsx("w-14 text-center text-xs font-bold", p.status === 'success' ? 'text-emerald-500' : p.status === 'error' ? 'text-red-500' : 'text-slate-400')}>
                            {p.status === 'pending' ? '-' : p.log || p.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 flex gap-4">
                    <button
                      onClick={runBatchMerge}
                      disabled={batchStatus === 'running' || !jflashExe || !jflashPrj || batchPairs.length === 0}
                      className={clsx(
                        "flex-1 h-14 rounded-2xl font-bold text-white shadow-xl transition-all flex items-center justify-center gap-2",
                        batchStatus === 'running' || !batchPairs.length ? "bg-slate-300 cursor-not-allowed" : "bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 hover:scale-[1.02] active:scale-95"
                      )}
                    >
                      {batchStatus === 'running' ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
                      {batchStatus === 'running' ? `合并中 (${processedCount}/${batchPairs.length})` : '开始 Merge'}
                    </button>
                  </div>
                  {batchStatus === 'done' && <p className="text-center text-sm text-emerald-600 font-bold mt-2">🎉 批量合并已完成</p>}
                </div>
              </div>
            )}
          </div>

          {/* 右侧：HID 信息面板 (固定宽度) */}
          <div className="w-80 flex flex-col gap-6 shrink-0">
            <GlassCard className="p-6 flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-700 flex items-center gap-2"><Usb className="text-blue-500" size={18} /> HID 设备</h3>
                <button onClick={refreshHid} className={clsx("p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-blue-500 transition-all", hidLoading && "animate-spin")}><RefreshCw size={14}/></button>
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
                {hidDevices.length === 0 ? (
                  <div className="text-center text-slate-300 text-xs py-10">未检测到 HID 设备</div>
                ) : (
                  [...hidDevices]
                    .sort((a, b) => (isBootModeDevice(a) ? 1 : 0) - (isBootModeDevice(b) ? 1 : 0))
                    .map((dev, i) => {
                    const key = hidDeviceKey(dev);
                    const highlighted = isHidHighlight(dev, lastFlashedHexKeywords);
                    const isBoot = isBootModeDevice(dev);
                    const canSwitchToBoot = !isBoot && Number(dev.usage_page) === 0xFF60;
                    const version = deviceVersions[key];
                    const isSelected = selectedHidKey === key;
                    const vidStr = dev.vid.toString(16).toUpperCase().padStart(4, '0');
                    const pidStr = dev.pid.toString(16).toUpperCase().padStart(4, '0');
                    const upageStr = dev.usage_page?.toString(16).toUpperCase().padStart(4, '0') ?? '—';
                    return (
                      <div
                        key={i}
                        onClick={() => setSelectedHidKey(isSelected ? null : key)}
                        className={clsx(
                          "p-3 rounded-xl shadow-sm hover:shadow-md transition-all group border cursor-pointer",
                          highlighted ? "bg-emerald-50 border-emerald-300 ring-2 ring-emerald-200" : isBoot ? "bg-amber-50/80 border-amber-200" : "bg-white border-slate-100"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-bold text-slate-700 text-sm truncate flex-1">{dev.product || "Unknown Device"}</div>
                          <span className="shrink-0 text-slate-400">{isSelected ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
                          {isBoot && <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded shrink-0">BOOT</span>}
                          {highlighted && <span className="text-[10px] font-bold text-emerald-600 shrink-0">烧录匹配</span>}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[10px] text-slate-400 uppercase">VID</span>
                          <span className="font-mono text-sm font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">0x{vidStr}</span>
                          <span className="text-slate-300">·</span>
                          <span className="text-[10px] text-slate-400 uppercase">PID</span>
                          <span className="font-mono text-sm font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">0x{pidStr}</span>
                          <span className="text-slate-300">·</span>
                          <span className="text-[10px] text-slate-400">UPage</span>
                          <span className="font-mono text-xs font-semibold text-slate-600">{upageStr}</span>
                        </div>
                        {version != null && (
                          <div className="mt-2 flex items-center gap-1.5">
                            <span className="text-[10px] text-slate-400 uppercase">版本</span>
                            <span className="font-mono text-sm font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">{version}</span>
                          </div>
                        )}
                        {isSelected && (
                          <div className="mt-3 pt-3 border-t border-slate-100 space-y-2" onClick={e => e.stopPropagation()}>
                            {isBoot ? (
                              <div className="text-[10px] text-amber-700 font-medium">当前为 BOOT 模式 · 上方 PID/VID 即为 BOOT 的 PID/VID</div>
                            ) : (
                              <>
                                <div className="text-[10px] text-slate-500 font-medium">当前为 APP 模式 · 可切换至 BOOT 模式查看 BOOT PID/VID</div>
                                <button
                                  onClick={async () => {
                                    setBootSwitchLoading(key);
                                    setBootSwitchTip(null);
                                    try {
                                      await invoke('switch_hid_to_boot_mode', {
                                        vid: dev.vid,
                                        pid: dev.pid,
                                        serial: dev.serial_number || null,
                                        usagePage: dev.usage_page ?? null
                                      });
                                      setBootSwitchTip('已发送进入 BOOT 指令，设备将重启；请稍后刷新列表查看 BOOT 设备（不同 PID/VID）');
                                      setTimeout(() => { refreshHid(); setBootSwitchTip(null); setSelectedHidKey(null); }, 3500);
                                    } catch (e: any) {
                                      setBootSwitchTip('发送失败: ' + String(e).slice(0, 40));
                                    }
                                    setBootSwitchLoading(null);
                                  }}
                                  disabled={bootSwitchLoading === key || !canSwitchToBoot}
                                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold disabled:opacity-50"
                                >
                                  {bootSwitchLoading === key ? <Loader2 size={12} className="animate-spin" /> : <Layers size={12} />}
                                  进入 BOOT 模式
                                </button>
                                {!canSwitchToBoot && (
                                  <div className="text-[10px] text-amber-700 bg-amber-50 rounded p-2">
                                    只有 Usage Page 为 0xFF60 的 APP 接口支持进入 BOOT。
                                  </div>
                                )}
                                {bootSwitchTip && selectedHidKey === key && (
                                  <div className="text-[10px] text-blue-600 bg-blue-50 rounded p-2">{bootSwitchTip}</div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                    })
                )}
              </div>
            </GlassCard>

            <GlassCard className="p-6 h-auto bg-gradient-to-br from-indigo-500 to-purple-600 border-none text-white">
              <div className="font-bold text-lg">System Ready</div>
              <div className="text-xs text-indigo-100 mt-1">J-Link Driver: {jflashExe ? 'Detected' : 'Searching...'}</div>
            </GlassCard>
          </div>

        </div>
      </main>

      {/* Help Modal (使用说明) */}
      {showHelp && (
        <div className="fixed inset-0 z-50 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center p-10 animate-in fade-in">
          <div className="bg-white w-full max-w-2xl max-h-[90vh] rounded-[2.5rem] shadow-2xl p-10 relative flex flex-col">
            <button onClick={() => setShowHelp(false)} className="absolute top-6 right-6 p-2 hover:bg-slate-100 rounded-full z-10"><XCircle size={24} className="text-slate-300 hover:text-slate-600" /></button>
            <h2 className="text-2xl font-black text-slate-800 mb-1">使用说明</h2>
            <p className="text-sm text-slate-500 mb-6">Bootloader + Application 合并为 HEX，配合 J-Flash 烧录。<span className="text-blue-600 font-semibold">单次</span> / <span className="text-indigo-600 font-semibold">批量</span> / <span className="text-amber-600 font-semibold">HEX 烧录</span>。</p>
            <div className="flex-1 overflow-y-auto pr-2 space-y-5 text-sm">
              {/* 一、设置 */}
              <section className="rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50/50 border border-blue-100 p-5">
                <h3 className="text-lg font-black text-blue-700 mb-1 flex items-center gap-2">
                  <span className="flex w-7 h-7 items-center justify-center rounded-lg bg-blue-500 text-white text-xs font-bold">1</span>
                  设置（首次使用必读）
                </h3>
                <p className="text-slate-600 text-xs mb-4">左侧边栏点击 <span className="inline-flex items-center px-2 py-0.5 rounded bg-white border border-slate-200 font-medium text-slate-700">设置</span>，配置会保存并自动生效。</p>
                <div className="space-y-4">
                  <div className="bg-white/80 rounded-xl p-4 border border-slate-100">
                    <h4 className="font-bold text-slate-800 mb-2 flex items-center gap-2 text-blue-700"><Cpu size={16} /> J-Flash.exe 路径</h4>
                    <p className="text-slate-600 text-xs mb-2">常见位置（按版本选一个）：</p>
                    <div className="flex items-center gap-2 mb-2">
                      <code className="flex-1 font-mono text-xs bg-slate-800 text-emerald-300 px-3 py-2 rounded-lg select-all cursor-text break-all" title="点击选中后可复制">
                        C:\Program Files\SEGGER\JLink_Vxxx\JFlash.exe
                      </code>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText('C:\\Program Files\\SEGGER\\JLink_Vxxx\\JFlash.exe')}
                        className="shrink-0 p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 hover:text-white transition-colors"
                        title="复制路径"
                      >
                        <Copy size={16} />
                      </button>
                    </div>
                    <p className="text-slate-500 text-xs mb-1 font-medium">操作步骤：</p>
                    <ol className="text-slate-600 text-xs space-y-1 list-decimal list-inside">
                      <li>资源管理器 → 进入 <code className="text-blue-600 bg-blue-50 px-1 rounded">C:\Program Files\SEGGER</code></li>
                      <li>在 <code className="text-indigo-600 bg-indigo-50 px-1 rounded">JLink_Vxxx</code> 文件夹中找到 <strong className="text-slate-700">JFlash.exe</strong></li>
                      <li>本工具设置里点击「J-Flash.exe」→ 选择该文件</li>
                    </ol>
                  </div>
                  <div className="bg-white/80 rounded-xl p-4 border border-slate-100">
                    <h4 className="font-bold text-slate-800 mb-2 flex items-center gap-2 text-indigo-700"><FileCog size={16} /> J-Flash 项目文件（.jflash）</h4>
                    <p className="text-slate-600 text-xs mb-2"><span className="font-semibold text-emerald-700">已有工程</span>：设置中选「Project File」直接选 .jflash。</p>
                    <p className="text-slate-600 text-xs mb-1"><span className="font-semibold text-amber-700">需要新配置</span>：</p>
                    <ol className="text-slate-600 text-xs space-y-1 list-decimal list-inside">
                      <li>单独打开 <strong>SEGGER J-Flash</strong></li>
                      <li>配置芯片、接口、速率等</li>
                      <li>菜单 <strong className="text-indigo-600">File → Save project as...</strong> 保存为 .jflash</li>
                      <li>回到本工具「Project File」中导入该文件</li>
                    </ol>
                  </div>
                  <div className="bg-white/80 rounded-xl p-3 border border-slate-100">
                    <h4 className="font-bold text-slate-800 mb-1 flex items-center gap-2 text-slate-700"><Hash size={16} /> Boot Addr / App Addr</h4>
                    <p className="text-slate-600 text-xs">默认 <span className="font-mono text-blue-600">0x08000000</span> / <span className="font-mono text-indigo-600">0x08020000</span>，在设置中按工程修改。</p>
                  </div>
                </div>
              </section>
              {/* 二、BOOT/APP 路径 */}
              <section className="rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50/50 border border-emerald-100 p-5">
                <h3 className="text-lg font-black text-emerald-700 mb-1 flex items-center gap-2">
                  <span className="flex w-7 h-7 items-center justify-center rounded-lg bg-emerald-500 text-white text-xs font-bold">2</span>
                  BOOT 与 APP 路径（可完全自定义）
                </h3>
                <div className="space-y-3 mt-3">
                  <div className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">单</span>
                    <p className="text-slate-600 text-xs">点击 <strong className="text-slate-700">Bootloader</strong>、<strong className="text-slate-700">Application</strong>，在<strong className="text-emerald-600">任意路径</strong>下选 BOOT/APP 文件（.bin / .hex）。</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold">批</span>
                    <p className="text-slate-600 text-xs">选 BOOT 目录、APP 目录（<strong className="text-emerald-600">任意路径</strong>），工具按文件名自动配对；输出目录可自定义。</p>
                  </div>
                </div>
              </section>
              {/* 三、功能入口 */}
              <section className="rounded-2xl bg-slate-50 border border-slate-200 p-5">
                <h3 className="text-lg font-black text-slate-800 mb-3 flex items-center gap-2">
                  <span className="flex w-7 h-7 items-center justify-center rounded-lg bg-slate-600 text-white text-xs font-bold">3</span>
                  功能入口
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-start gap-2 rounded-xl bg-white p-3 border border-blue-100">
                    <Zap className="shrink-0 text-blue-500 mt-0.5" size={18} />
                    <div><span className="font-bold text-blue-600">合并</span><span className="text-slate-600 text-xs block">单次 BOOT+APP → HEX，可烧录</span></div>
                  </div>
                  <div className="flex items-start gap-2 rounded-xl bg-white p-3 border border-indigo-100">
                    <Layers className="shrink-0 text-indigo-500 mt-0.5" size={18} />
                    <div><span className="font-bold text-indigo-600">批量</span><span className="text-slate-600 text-xs block">多对自动匹配合并</span></div>
                  </div>
                  <div className="flex items-start gap-2 rounded-xl bg-white p-3 border border-amber-100">
                    <Flame className="shrink-0 text-amber-500 mt-0.5" size={18} />
                    <div><span className="font-bold text-amber-600">HEX烧录</span><span className="text-slate-600 text-xs block">选 HEX 文件直接烧录</span></div>
                  </div>
                  <div className="flex items-start gap-2 rounded-xl bg-white p-3 border border-slate-200">
                    <Settings className="shrink-0 text-slate-500 mt-0.5" size={18} />
                    <div><span className="font-bold text-slate-700">设置</span><span className="text-slate-600 text-xs block">J-Flash、.jflash、地址</span></div>
                  </div>
                </div>
              </section>
              {/* 四、使用前检查 */}
              <section className="rounded-2xl bg-amber-50/80 border border-amber-200 p-5">
                <h3 className="text-lg font-black text-amber-800 mb-3 flex items-center gap-2">
                  <span className="flex w-7 h-7 items-center justify-center rounded-lg bg-amber-500 text-white text-xs font-bold">4</span>
                  使用前检查
                </h3>
                <ul className="space-y-2">
                  {[
                    { done: true, text: '设置中已选 J-Flash.exe（建议到 C:\\Program Files\\SEGGER 下按版本选）' },
                    { done: true, text: '已选或新建 .jflash；新配置先在 J-Flash 中保存再导入' },
                    { done: true, text: 'Boot Addr、App Addr 与工程一致' },
                    { done: true, text: 'BOOT/APP 路径可任意自定义' },
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <CheckCircle2 className="shrink-0 text-emerald-500 mt-0.5" size={16} />
                      <span className={item.done ? "text-slate-700" : "text-slate-600"}>{item.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-200 flex justify-end">
              <button onClick={() => setShowHelp(false)} className="px-8 py-3 bg-slate-800 text-white rounded-xl font-bold hover:bg-black transition-colors shadow-lg">关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal (Overlay) */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center p-10 animate-in fade-in">
          <div className="bg-white w-full max-w-xl rounded-[2.5rem] shadow-2xl p-10 relative">
            <button onClick={() => setShowSettings(false)} className="absolute top-6 right-6 p-2 hover:bg-slate-100 rounded-full"><XCircle size={24} className="text-slate-300 hover:text-slate-600" /></button>
            <h2 className="text-2xl font-black text-slate-800 mb-8">Global Settings</h2>
            <div className="space-y-6">
              <CleanInput label="J-Flash.exe" value={jflashExe} onClick={() => handleSelect('exe')} icon={Cpu} />
              <CleanInput label="Project File" value={jflashPrj} onClick={() => handleSelect('prj')} icon={FileCog} />
              <div className="grid grid-cols-2 gap-6">
                <CleanInput label="Boot Addr" value={bootAddr} onChange={(e:any) => setBootAddr(e.target.value)} readOnly={false} icon={Hash} />
                <CleanInput label="App Addr" value={appAddr} onChange={(e:any) => setAppAddr(e.target.value)} readOnly={false} icon={Hash} />
              </div>
            </div>
            <div className="mt-10 flex justify-end">
              <button onClick={() => setShowSettings(false)} className="px-8 py-3 bg-slate-800 text-white rounded-xl font-bold hover:bg-black transition-colors shadow-lg">Save & Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
