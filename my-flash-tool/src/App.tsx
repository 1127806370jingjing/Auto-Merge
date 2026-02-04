import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readDir } from '@tauri-apps/plugin-fs';
import { load } from '@tauri-apps/plugin-store';
import { 
  Settings, Layers, Zap, CheckCircle2, XCircle, Loader2, Cpu, FileCog, 
  Sparkles, AlertTriangle, ArrowRight, FolderOutput, FolderOpen, Hash, Link2, Unlink, 
  Play, Usb, RefreshCw, Box, Flame
} from 'lucide-react';
import clsx from 'clsx';
import { autoMatchFiles, FilePair, verifyFileNameMatch } from './utils/matcher';

const getStore = async () => await load('settings.json');

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

const CleanInput = ({ label, value, onClick, onChange, icon: Icon, placeholder = "点击选择...", readOnly = true, rightElement }: any) => (
  <div className="w-full">
    <div className="flex items-center justify-between px-1 mb-1.5">
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
        <div className="w-1 h-3 bg-blue-400 rounded-full"></div>
        {label}
      </label>
      {rightElement}
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
  const [tab, setTab] = useState<'single' | 'batch'>('single');
  const [showSettings, setShowSettings] = useState(false);
  
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

  useEffect(() => { init(); }, []);

  // HID 设备列表自动刷新（每 8 秒）
  useEffect(() => {
    const t = setInterval(refreshHid, 500);
    return () => clearInterval(t);
  }, []);

  const init = async () => {
    const s = await getStore();
    setJflashPrj((await s.get<string>('jflash_prj')) || '');
    setBootAddr((await s.get<string>('addr_boot')) || '0x08000000');
    setAppAddr((await s.get<string>('addr_app')) || '0x08020000');
    setOutDir((await s.get<string>('last_out_dir')) || '');
    setBatchOutDir((await s.get<string>('last_batch_out')) || '');
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
    if (key.includes('dir') || key.includes('out') || isDir) {
      const p = await open({ directory: true });
      if (p && typeof p === 'string') {
        const s = await getStore();
        if (key === 'out_dir') { setOutDir(p); s.set('last_out_dir', p); }
        if (key === 'batch_out') { setBatchOutDir(p); s.set('last_batch_out', p); }
        if (key === 'b_boot') setBatchBootDir(p);
        if (key === 'b_app') setBatchAppDir(p);
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
      refreshHid(); // 烧录完自动刷新 HID
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
        </div>
        <div className="mt-auto">
          <NavButton onClick={() => setShowSettings(true)} icon={Settings} label="设置" />
        </div>
      </aside>

      {/* 🚀 主内容区 */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#f8fafc] relative">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:20px_20px] opacity-50 pointer-events-none"></div>
        
        {/* 顶部标题 */}
        <header className="px-10 py-8 z-10">
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">
            {tab === 'single' ? 'Single Merge & Verify' : 'Batch Processor'}
          </h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">J-Flash Automation Tool</p>
        </header>

        <div className="flex-1 px-10 pb-10 overflow-hidden flex gap-8 z-10">
          
          {/* 左侧：操作卡片 (自适应宽度) */}
          <div className="flex-1 flex flex-col min-w-0 h-full">
            {tab === 'single' ? (
              <GlassCard className="h-full p-8 flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-300">
                {/* 文件选择 */}
                <div className="space-y-4">
                  <CleanInput label="Bootloader" value={bootPath} onClick={() => handleSelect('boot')} icon={Layers} 
                    rightElement={matchStatus === 'matched' ? <CheckCircle2 className="text-emerald-500" size={16}/> : matchStatus === 'mismatch' ? <Unlink className="text-red-500" size={16}/> : null} />
                  
                  <div className="flex justify-center -my-2 opacity-20"><ArrowRight className="rotate-90" /></div>
                  
                  <CleanInput label="Application" value={appPath} onClick={() => handleSelect('app')} icon={Zap} 
                    rightElement={matchStatus === 'matched' ? <CheckCircle2 className="text-emerald-500" size={16}/> : matchStatus === 'mismatch' ? <Unlink className="text-red-500" size={16}/> : null} />
                </div>

                {/* 配置区 */}
                <div className="grid grid-cols-2 gap-4">
                  <CleanInput label="物料号 (前缀)" value={materialCode} onChange={(e:any) => setMaterialCode(e.target.value)} readOnly={false} icon={Hash} placeholder="例如 2211..." />
                  <CleanInput label="输出目录" value={getPreviewPath()} onClick={() => handleSelect('out_dir')} icon={FolderOutput} placeholder="默认同级" />
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
                    <CleanInput label="Boot 目录" value={batchBootDir} onClick={() => handleSelect('b_boot', true)} icon={FolderOpen} placeholder="选择文件夹" />
                    <CleanInput label="App 目录" value={batchAppDir} onClick={() => handleSelect('b_app', true)} icon={FolderOpen} placeholder="选择文件夹" />
                    <CleanInput label="HEX 输出目录" value={batchOutDir} onClick={() => handleSelect('batch_out')} icon={FolderOutput} placeholder="默认 App/Merged_Output" />
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
                  hidDevices.map((dev, i) => (
                    <div key={i} className="bg-white border border-slate-100 p-3 rounded-xl shadow-sm hover:shadow-md transition-all group">
                      <div className="font-bold text-slate-700 text-sm truncate">{dev.product || "Unknown Device"}</div>
                      <div className="text-[10px] text-slate-400 font-mono mt-1 group-hover:text-blue-500">
                        VID: {dev.vid.toString(16).toUpperCase().padStart(4,'0')} <br/>
                        PID: {dev.pid.toString(16).toUpperCase().padStart(4,'0')}
                      </div>
                    </div>
                  ))
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