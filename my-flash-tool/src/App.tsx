import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readDir } from '@tauri-apps/plugin-fs';
import { load } from '@tauri-apps/plugin-store';
import { Settings, FolderOpen, Save, Layers, Zap, CheckCircle2, XCircle, Loader2, Cpu, FileCog, Sparkles, AlertTriangle, ArrowRight, FolderOutput, Hash, Link2, Unlink, Ban } from 'lucide-react';
import clsx from 'clsx';
import { autoMatchFiles, FilePair, verifyFileNameMatch } from './utils/matcher';

const getStore = async () => await load('settings.json');

// ✨ UI组件：果冻质感输入框
const JellyInput = ({ label, value, onClick, onChange, icon: Icon, theme = "blue", placeholder = "请选择...", readOnly = true, statusIcon }: any) => {
  const themes: any = {
    blue: "bg-blue-50/50 text-blue-500 border-blue-100 group-hover:bg-blue-500 group-hover:text-white",
    pink: "bg-pink-50/50 text-pink-500 border-pink-100 group-hover:bg-pink-500 group-hover:text-white",
    purple: "bg-purple-50/50 text-purple-500 border-purple-100 group-hover:bg-purple-500 group-hover:text-white",
    orange: "bg-orange-50/50 text-orange-500 border-orange-100 group-hover:bg-orange-500 group-hover:text-white",
    green: "bg-emerald-50/50 text-emerald-500 border-emerald-100 group-hover:bg-emerald-500 group-hover:text-white",
    // 🔴 错误主题：显眼的红色
    red: "bg-red-50 text-red-500 border-red-300 group-hover:bg-red-500 group-hover:text-white ring-1 ring-red-200", 
  };

  return (
    <div className="w-full group flex flex-col h-full">
      <div className="flex items-center gap-2 mb-1.5 ml-1 shrink-0 justify-between pr-2">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${theme === 'red' ? 'bg-red-500 animate-pulse' : 'bg-slate-300'}`}></span>
          <label className={`text-[10px] font-bold uppercase tracking-wider ${theme === 'red' ? 'text-red-500' : 'text-slate-400'}`}>{label}</label>
        </div>
        {statusIcon}
      </div>
      <div 
        onClick={!readOnly ? undefined : onClick}
        className={`relative flex-1 flex items-center gap-3 bg-white border shadow-sm hover:shadow-lg hover:-translate-y-0.5 rounded-2xl p-3 cursor-pointer transition-all duration-300 active:scale-[0.98] ${themes[theme] || themes.blue}`}
      >
        <div className="p-2 rounded-xl bg-white/50 backdrop-blur">
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          {readOnly ? (
            <div className="text-sm font-bold truncate font-mono" title={value}>
              {value ? value.split('\\').pop() : <span className="opacity-50 font-sans italic">{placeholder}</span>}
            </div>
          ) : (
            <input 
              value={value} 
              onChange={onChange}
              placeholder={placeholder}
              className="w-full text-sm font-bold bg-transparent outline-none placeholder:opacity-50 placeholder:font-sans placeholder:italic"
            />
          )}
        </div>
      </div>
    </div>
  );
};

function App() {
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [showSettings, setShowSettings] = useState(false);
  
  const [jflashExe, setJflashExe] = useState('');
  const [jflashPrj, setJflashPrj] = useState('');
  const [bootAddr, setBootAddr] = useState('0x08000000');
  const [appAddr, setAppAddr] = useState('0x08020000');

  // Single Mode State
  const [bootPath, setBootPath] = useState('');
  const [appPath, setAppPath] = useState('');
  const [outDir, setOutDir] = useState('');
  const [singleMaterialCode, setSingleMaterialCode] = useState('');
  const [singleMatchStatus, setSingleMatchStatus] = useState<'idle' | 'matched' | 'mismatch'>('idle'); 
  const [singleStatus, setSingleStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [singleLog, setSingleLog] = useState('');
  
  // ... Batch Mode State 省略 ...
  const [batchBootDir, setBatchBootDir] = useState('');
  const [batchAppDir, setBatchAppDir] = useState('');
  const [batchOutputDir, setBatchOutputDir] = useState('');
  const [batchPairs, setBatchPairs] = useState<FilePair[]>([]);
  const [batchStatus, setBatchStatus] = useState<'idle' | 'running' | 'done'>('idle');
  const [processedCount, setProcessedCount] = useState(0);

  useEffect(() => { init(); }, []);

  const init = async () => {
    const store = await getStore();
    setJflashPrj((await store.get<string>('jflash_prj')) || '');
    setBootAddr((await store.get<string>('addr_boot')) || '0x08000000');
    setAppAddr((await store.get<string>('addr_app')) || '0x08020000');
    setBatchOutputDir((await store.get<string>('last_batch_out')) || '');
    setOutDir((await store.get<string>('last_single_out_dir')) || '');
    setSingleMaterialCode((await store.get<string>('last_material_num')) || '');
    const exe = await store.get<string>('jflash_exe');
    if (exe) setJflashExe(exe); else autoDetect();
  };

  const autoDetect = async () => { try { const path = await invoke<string>('auto_detect_jflash'); setJflashExe(path); (await getStore()).set('jflash_exe', path).then(s => s.save()); } catch (e) {} };

  // 🧠 核心：严格匹配监听器
  useEffect(() => {
    if (!bootPath || !appPath) {
      setSingleMatchStatus('idle');
      setSingleLog("请选择 Bootloader 和 Application 文件");
      return;
    }

    const separator = bootPath.includes('\\') ? '\\' : '/';
    const bootName = bootPath.split(separator).pop() || '';
    const appName = appPath.split(separator).pop() || '';

    // 调用新的验证函数
    const { isMatch, commonTokens } = verifyFileNameMatch(bootName, appName);

    if (isMatch) {
      setSingleMatchStatus('matched');
      // 显示匹配到的关键词，让用户安心
      setSingleLog(`✅ 匹配成功！识别到关键词: [ ${commonTokens.join(', ')} ]`);
    } else {
      setSingleMatchStatus('mismatch');
      setSingleLog(`❌ 严重错误：文件名不匹配！\nBoot: ${bootName}\nApp: ${appName}\n\n未发现共同的型号特征词 (如 RS7, Air 等)`);
    }
  }, [bootPath, appPath]);

  // 🔄 预览路径生成 (同前)
  const getPreviewPath = () => {
    if (!appPath) return '';
    const separator = appPath.includes('\\') ? '\\' : '/';
    let targetDir = outDir;
    if (!targetDir) targetDir = appPath.substring(0, appPath.lastIndexOf(separator));
    const appFileName = appPath.split(separator).pop() || '';
    const baseName = appFileName.replace(/\.[^/.]+$/, "");
    const prefix = singleMaterialCode ? `${singleMaterialCode}_` : '';
    const fileName = `${prefix}${baseName}_Merged.hex`;
    const safeSep = targetDir.endsWith(separator) ? '' : separator;
    return `${targetDir}${safeSep}${fileName}`;
  };

  const handleSelect = async (key: string, isDir = false) => {
    if (key === 'out_dir') {
      const p = await open({ directory: true });
      if (p && typeof p === 'string') { setOutDir(p); const s = await getStore(); s.set('last_single_out_dir', p); s.save(); }
      return;
    }
    const res = await open({ directory: isDir, multiple: false, recursive: isDir, filters: !isDir ? [{ name: 'Files', extensions: ['exe', 'jflash', 'bin', 'hex'] }] : [] });
    if (typeof res === 'string') {
      const store = await getStore();
      if (key === 'boot') setBootPath(res);
      else if (key === 'app') setAppPath(res);
      else if (key === 'exe') { setJflashExe(res); store.set('jflash_exe', res); }
      else if (key === 'prj') { setJflashPrj(res); store.set('jflash_prj', res); }
      else if (key === 'b_boot') setBatchBootDir(res);
      else if (key === 'b_app') setBatchAppDir(res);
      else if (key === 'b_out') { setBatchOutputDir(res); store.set('last_batch_out', res); }
      store.save();
    }
  };

  const runSingle = async () => {
    if (!jflashExe || !jflashPrj) return setShowSettings(true);
    
    // 🚨 严格阻断：如果不匹配，直接返回
    if (singleMatchStatus === 'mismatch') {
      setSingleLog('⛔️ 禁止执行：文件型号不匹配，请检查文件！');
      return;
    }
    
    const finalPath = getPreviewPath();
    if (!finalPath) return setSingleLog('❌ 路径无效');

    const s = await getStore(); s.set('last_material_num', singleMaterialCode); s.save();

    setSingleStatus('running'); setSingleLog('⏳ 正在生成 HEX...');
    try {
      // 默认单文件模式只生成不烧录 (onlyMerge: true) 以避免报错
      // 如果你需要烧录，可以把 onlyMerge 改为 false，或者加个开关
      const res = await invoke<string>('execute_merge_and_flash', {
        jflashPath: jflashExe, projectPath: jflashPrj,
        bootPath, appPath, outputPath: finalPath, bootAddr, appAddr, 
        onlyMerge: true 
      });
      setSingleLog(res); setSingleStatus('success');
    } catch (e: any) { setSingleLog(e.toString()); setSingleStatus('error'); }
  };

  // ... (Batch Logic 复用) ...
  useEffect(() => { if (batchBootDir && batchAppDir) scanBatch(); }, [batchBootDir, batchAppDir]);
  const scanBatch = async () => { try { const bFiles = (await readDir(batchBootDir)).filter(e => e.name?.toLowerCase().endsWith('.bin') || e.name?.toLowerCase().endsWith('.hex')).map(e => ({ name: e.name, path: `${batchBootDir}\\${e.name}` })); const aFiles = (await readDir(batchAppDir)).filter(e => e.name?.toLowerCase().endsWith('.bin') || e.name?.toLowerCase().endsWith('.hex')).map(e => ({ name: e.name, path: `${batchAppDir}\\${e.name}` })); setBatchPairs(autoMatchFiles(bFiles, aFiles)); } catch (e) { console.error(e); } };
  const updatePairCode = (index: number, code: string) => { const newPairs = [...batchPairs]; newPairs[index].materialCode = code; setBatchPairs(newPairs); };
  const runBatch = async () => { if (batchPairs.length === 0) return; setBatchStatus('running'); setProcessedCount(0); const outRootDir = batchOutputDir || `${batchAppDir}\\Merged_Output`; const newPairs = [...batchPairs]; for (let i = 0; i < newPairs.length; i++) { const p = newPairs[i]; const prefix = p.materialCode ? `${p.materialCode}_` : ''; const finalFileName = `${prefix}${p.outName}`; const out = `${outRootDir}\\${finalFileName}`; try { await invoke('execute_merge_and_flash', { jflashPath: jflashExe, projectPath: jflashPrj, bootPath: p.boot.path, appPath: p.app.path, outputPath: out, bootAddr, appAddr, onlyMerge: true }); p.status = 'success'; p.log = `✅ 生成成功: ${finalFileName}`; } catch (e: any) { p.status = 'error'; p.log = `❌ ${e}`; } setBatchPairs([...newPairs]); setProcessedCount(i + 1); } setBatchStatus('done'); };

  return (
    <div className="h-screen w-screen bg-[#f8fafc] text-slate-600 font-sans flex flex-col relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-100/40 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-pink-100/40 rounded-full blur-[120px] pointer-events-none" />

      {/* Nav */}
      <div className="px-6 py-4 z-10 flex justify-between items-center bg-white/50 backdrop-blur-sm border-b border-white/50 shrink-0">
        <div className="flex items-center gap-3"><div className="bg-gradient-to-br from-blue-400 to-indigo-500 p-2 rounded-xl shadow-lg shadow-blue-200"><Cpu className="text-white w-5 h-5" /></div><h1 className="text-lg font-extrabold text-slate-700 tracking-tight hidden md:block">Flash Master</h1></div>
        <div className="bg-slate-100/50 p-1 rounded-2xl border border-white flex gap-1"><button onClick={() => setMode('single')} className={clsx("px-4 md:px-6 py-1.5 rounded-xl text-xs font-bold transition-all duration-300", mode === 'single' ? "bg-white text-blue-600 shadow-sm" : "text-gray-400 hover:text-gray-600")}>单文件</button><button onClick={() => setMode('batch')} className={clsx("px-4 md:px-6 py-1.5 rounded-xl text-xs font-bold transition-all duration-300", mode === 'batch' ? "bg-white text-purple-600 shadow-sm" : "text-gray-400 hover:text-gray-600")}>批量处理</button></div>
        <button onClick={() => setShowSettings(true)} className="p-2.5 bg-white rounded-2xl border border-slate-100 text-slate-400 hover:text-blue-500 transition-all shadow-sm"><Settings size={20} /></button>
      </div>

      <main className="flex-1 overflow-hidden relative z-10 flex flex-col p-4 md:p-6 items-center">
        {mode === 'single' && (
          <div className="w-full max-w-lg bg-white/60 backdrop-blur-xl rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white p-6 md:p-8 animate-in zoom-in-95 duration-500 relative flex flex-col gap-4 m-auto">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-300 via-pink-300 to-purple-300 opacity-50"></div>
            
            {/* 🔴 状态联动：如果不匹配，主题变红，图标变断开 */}
            <JellyInput label="Bootloader" value={bootPath} onClick={() => handleSelect('boot')} icon={Layers} 
              theme={singleMatchStatus === 'mismatch' ? "red" : "blue"}
              statusIcon={singleMatchStatus === 'matched' ? <Link2 size={14} className="text-green-500"/> : singleMatchStatus === 'mismatch' ? <Unlink size={14} className="text-red-500"/> : null} />
            <div className="flex justify-center -my-2 z-0 opacity-30"><ArrowRight className="text-slate-300 rotate-90" size={16} /></div>
            <JellyInput label="Application" value={appPath} onClick={() => handleSelect('app')} icon={Zap} 
              theme={singleMatchStatus === 'mismatch' ? "red" : "pink"}
              statusIcon={singleMatchStatus === 'matched' ? <Link2 size={14} className="text-green-500"/> : singleMatchStatus === 'mismatch' ? <Unlink size={14} className="text-red-500"/> : null} />

            <div className="flex items-center gap-2 py-2"><div className="h-px bg-slate-200 flex-1"></div><span className="text-[10px] text-slate-400 font-bold bg-white/50 px-2 rounded-full border border-slate-100">配置</span><div className="h-px bg-slate-200 flex-1"></div></div>
            
            <JellyInput label="物料编号前缀" value={singleMaterialCode} onChange={(e: any) => setSingleMaterialCode(e.target.value)} readOnly={false} placeholder="例如: 22110510" icon={Hash} theme="orange" />
            <div className="flex justify-center -my-2 z-0 opacity-30"><ArrowRight className="text-slate-300 rotate-90" size={16} /></div>
            <JellyInput label="保存目录" value={getPreviewPath()} onClick={() => handleSelect('out_dir')} icon={FolderOutput} theme="purple" />

            {/* 🔴 按钮控制：不匹配则变红且禁用 */}
            <button 
              onClick={runSingle} 
              disabled={singleStatus === 'running' || singleMatchStatus === 'mismatch'} 
              className={clsx(
                "w-full h-12 mt-4 rounded-2xl font-bold text-white shadow-xl shadow-blue-200/50 transition-all active:scale-95 flex items-center justify-center gap-2",
                singleStatus === 'running' ? "bg-slate-300 cursor-not-allowed" : 
                singleMatchStatus === 'mismatch' ? "bg-red-500 cursor-not-allowed hover:bg-red-600 shadow-red-200" :
                "bg-gradient-to-r from-blue-400 to-indigo-500 hover:brightness-110"
              )}
            >
              {singleStatus === 'running' ? <Loader2 className="animate-spin" /> : singleMatchStatus === 'mismatch' ? <Ban /> : <Sparkles />}
              {singleStatus === 'running' ? "处理中..." : singleMatchStatus === 'mismatch' ? "文件名不匹配 (禁止操作)" : "开始生成 HEX"}
            </button>

            <div className={clsx("p-4 rounded-2xl text-xs font-mono border min-h-[60px] flex items-center gap-3 transition-colors", 
              singleStatus === 'error' || singleMatchStatus === 'mismatch' ? "bg-red-50 text-red-500 border-red-100" : 
              singleStatus === 'success' ? "bg-green-50 text-green-600 border-green-100" : "bg-white/50 text-slate-400 border-white")}>
              {(singleStatus === 'error' || singleMatchStatus === 'mismatch') && <AlertTriangle size={20} className="shrink-0"/>}
              {singleStatus === 'success' && <CheckCircle2 size={20} className="shrink-0"/>}
              <div className="break-all whitespace-pre-wrap">{singleLog || "请选择文件，系统将自动校验..."}</div>
            </div>
          </div>
        )}

        {mode === 'batch' && (
          <div className="w-full max-w-5xl h-full flex flex-col gap-4 animate-in zoom-in-95 duration-500">
             {/* 批量模式代码保持不变，直接复用 */}
             <div className="bg-white/60 backdrop-blur-xl rounded-[2rem] border border-white p-6 shadow-sm shrink-0"><div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4"><JellyInput label="Boot 文件夹" value={batchBootDir} onClick={() => handleSelect('b_boot', true)} icon={FolderOpen} theme="blue" /><JellyInput label="App 文件夹" value={batchAppDir} onClick={() => handleSelect('b_app', true)} icon={FolderOpen} theme="pink" /></div><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div className="md:col-span-2"><JellyInput label="HEX 输出位置 (默认: App/Merged_Output)" value={batchOutputDir} onClick={() => handleSelect('b_out', true)} icon={FolderOutput} theme="green" placeholder="默认同级目录..." /></div></div></div><div className="flex-1 min-h-0 bg-white/40 backdrop-blur-md rounded-[2rem] border border-white shadow-inner flex flex-col overflow-hidden relative"><div className="px-6 py-3 bg-white/40 border-b border-white flex justify-between text-xs font-bold text-slate-400 uppercase tracking-wider shrink-0"><span>匹配任务队列</span><span className={batchStatus === 'running' ? 'text-blue-500' : ''}>{batchStatus === 'running' ? `处理中 ${processedCount}/${batchPairs.length}` : `共 ${batchPairs.length} 项`}</span></div><div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">{batchPairs.length === 0 && (<div className="h-full flex flex-col items-center justify-center text-slate-300 gap-3"><Layers size={48} className="opacity-20" /><p className="font-bold text-xs">请选择文件夹以开始自动匹配</p></div>)}{batchPairs.map((p, index) => (<div key={p.id} className="bg-white p-3 rounded-2xl border border-slate-50 shadow-sm hover:shadow-md transition-all group"><div className="flex items-center justify-between gap-4"><div className="flex flex-col gap-1 text-xs font-mono overflow-hidden flex-1 min-w-0"><div className="flex items-center gap-2 truncate"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0"></span><span className="text-slate-500 truncate" title={p.boot.name}>{p.boot.name}</span></div><div className="flex items-center gap-2 truncate"><span className="w-1.5 h-1.5 rounded-full bg-pink-400 shrink-0"></span><span className="text-slate-600 font-bold truncate" title={p.app.name}>{p.app.name}</span></div></div><div className="flex items-center gap-2 bg-slate-50 px-2 py-1.5 rounded-lg border border-transparent hover:border-blue-200 transition-colors shrink-0 w-32 md:w-48"><Hash size={12} className="text-slate-400" /><input className="bg-transparent text-xs font-mono font-bold text-slate-700 outline-none w-full placeholder:text-slate-300 placeholder:font-sans" placeholder="输入物料号..." value={p.materialCode || ''} onChange={(e) => updatePairCode(index, e.target.value)} /></div><div className="pl-2 shrink-0">{p.status === 'success' && <div className="bg-green-100 text-green-600 p-1 rounded-full"><CheckCircle2 size={14} /></div>}{p.status === 'error' && <div className="bg-red-100 text-red-500 p-1 rounded-full"><XCircle size={14} /></div>}{p.status === 'pending' && <div className="w-1.5 h-1.5 bg-slate-200 rounded-full mx-2" />}</div></div>{p.log && <div className={clsx("text-[10px] px-2 py-1 rounded-lg border whitespace-pre-wrap font-mono mt-2 truncate", p.status === 'error' ? "text-red-500 border-red-100 bg-red-50/50" : "text-green-600 border-green-100 bg-green-50/50")} title={p.log}>{p.log}</div>}</div>))}</div></div><button onClick={runBatch} disabled={batchStatus === 'running' || batchPairs.length === 0} className={clsx("w-full h-12 rounded-2xl font-bold text-white shadow-xl shadow-purple-200/50 transition-all active:scale-[0.98] flex items-center justify-center gap-2 shrink-0", batchStatus === 'running' ? "bg-slate-300 cursor-not-allowed" : "bg-gradient-to-r from-purple-400 to-pink-500 hover:brightness-110")}>{batchStatus === 'running' ? <Loader2 className="animate-spin" /> : <Layers />}{batchStatus === 'running' ? "正在批量生成..." : "一键批量生成 HEX"}</button></div>
        )}
      </main>

      {/* Settings Modal (保持不变) */}
      {showSettings && (<div className="fixed inset-0 z-50 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"><div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 relative overflow-hidden"><div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-400 to-purple-400"></div><h2 className="text-lg font-bold text-slate-700 mb-6 flex items-center gap-2"><Settings size={20} className="text-blue-500" /> 全局配置</h2><div className="space-y-4"><JellyInput label="J-FLASH EXE PATH" value={jflashExe} onClick={() => handleSelect('exe')} icon={Cpu} theme="blue" /><JellyInput label="PROJECT FILE (.jflash)" value={jflashPrj} onClick={() => handleSelect('prj')} icon={FileCog} theme="purple" /><div className="grid grid-cols-2 gap-4"><div><label className="text-[10px] font-bold text-slate-400 ml-2 mb-1 block">BOOT ADDR (0x)</label><input value={bootAddr} onChange={e=>setBootAddr(e.target.value)} className="w-full p-3 bg-slate-50 rounded-2xl border-none font-mono text-sm text-slate-600 focus:ring-2 ring-blue-200 outline-none transition-all" /></div><div><label className="text-[10px] font-bold text-slate-400 ml-2 mb-1 block">APP ADDR (0x)</label><input value={appAddr} onChange={e=>setAppAddr(e.target.value)} className="w-full p-3 bg-slate-50 rounded-2xl border-none font-mono text-sm text-slate-600 focus:ring-2 ring-purple-200 outline-none transition-all" /></div></div></div><div className="mt-8 flex justify-end"><button onClick={() => setShowSettings(false)} className="px-8 py-3 bg-slate-800 text-white rounded-2xl text-xs font-bold hover:bg-slate-900 transition-colors shadow-lg shadow-slate-200">完成设置</button></div></div></div>)}
    </div>
  );
}

export default App;