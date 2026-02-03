import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readDir } from '@tauri-apps/plugin-fs';
import { load } from '@tauri-apps/plugin-store';
import { Settings, FolderOpen, Save, Layers, Zap, CheckCircle2, XCircle, Loader2, Cpu, FileCog, Sparkles, AlertTriangle, ArrowRight } from 'lucide-react';
import clsx from 'clsx';
import { autoMatchFiles, FilePair } from './utils/matcher';

const getStore = async () => await load('settings.json');

// ✨ UI组件：果冻质感输入框
const JellyInput = ({ label, value, onClick, icon: Icon, theme = "blue" }: any) => {
  const themes: any = {
    blue: "bg-blue-50/50 text-blue-500 group-hover:bg-blue-500 group-hover:text-white border-blue-100",
    pink: "bg-pink-50/50 text-pink-500 group-hover:bg-pink-500 group-hover:text-white border-pink-100",
    purple: "bg-purple-50/50 text-purple-500 group-hover:bg-purple-500 group-hover:text-white border-purple-100",
  };

  return (
    <div className="w-full group">
      <div className="flex items-center gap-2 mb-1.5 ml-1">
        <span className={`w-1.5 h-1.5 rounded-full ${theme === 'blue' ? 'bg-blue-400' : theme === 'pink' ? 'bg-pink-400' : 'bg-purple-400'}`}></span>
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</label>
      </div>
      <div 
        onClick={onClick}
        className="relative flex items-center gap-3 bg-white border border-slate-100 hover:border-blue-200 shadow-sm hover:shadow-lg hover:-translate-y-0.5 rounded-2xl p-3 cursor-pointer transition-all duration-300 active:scale-95"
      >
        <div className={`p-2.5 rounded-xl transition-all duration-300 border ${themes[theme]}`}>
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-slate-600 truncate font-mono">
            {value ? value.split('\\').pop() : <span className="text-slate-300 font-sans italic">请选择文件...</span>}
          </div>
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

  // 单文件状态
  const [bootPath, setBootPath] = useState('');
  const [appPath, setAppPath] = useState('');
  const [outPath, setOutPath] = useState('');
  const [singleStatus, setSingleStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [singleLog, setSingleLog] = useState('');

  // 批量状态
  const [batchBootDir, setBatchBootDir] = useState('');
  const [batchAppDir, setBatchAppDir] = useState('');
  const [batchPairs, setBatchPairs] = useState<FilePair[]>([]);
  const [batchStatus, setBatchStatus] = useState<'idle' | 'running' | 'done'>('idle');
  const [processedCount, setProcessedCount] = useState(0);

  useEffect(() => { init(); }, []);

  const init = async () => {
    const store = await getStore();
    setJflashPrj((await store.get<string>('jflash_prj')) || '');
    setBootAddr((await store.get<string>('addr_boot')) || '0x08000000');
    setAppAddr((await store.get<string>('addr_app')) || '0x08020000');
    const exe = await store.get<string>('jflash_exe');
    if (exe) setJflashExe(exe); else autoDetect();
  };

  const autoDetect = async () => {
    try {
      const path = await invoke<string>('auto_detect_jflash');
      setJflashExe(path);
      (await getStore()).set('jflash_exe', path).then(s => s.save());
    } catch (e) {}
  };

  const handleSelect = async (key: string, isDir = false, isSave = false) => {
    if (isSave) {
      const p = await save({ filters: [{ name: 'Hex', extensions: ['hex'] }] });
      if (p) setOutPath(p); return;
    }
    const res = await open({ 
      directory: isDir, multiple: false, recursive: isDir,
      filters: !isDir ? [{ name: 'Files', extensions: ['exe', 'jflash', 'bin', 'hex'] }] : []
    });
    if (typeof res === 'string') {
      if (key === 'boot') setBootPath(res);
      if (key === 'app') setAppPath(res);
      if (key === 'exe') { setJflashExe(res); (await getStore()).set('jflash_exe', res).then(s => s.save()); }
      if (key === 'prj') { setJflashPrj(res); (await getStore()).set('jflash_prj', res).then(s => s.save()); }
      if (key === 'b_boot') setBatchBootDir(res);
      if (key === 'b_app') setBatchAppDir(res);
    }
  };

  const runSingle = async () => {
    if (!jflashExe || !jflashPrj) return setShowSettings(true);
    if (!bootPath || !appPath || !outPath) return setSingleLog('❌ 请补全所有路径');
    setSingleStatus('running'); setSingleLog('⏳ 正在努力处理中...');
    try {
      const res = await invoke<string>('execute_merge_and_flash', {
        jflashPath: jflashExe, projectPath: jflashPrj,
        bootPath, appPath, outputPath: outPath, bootAddr, appAddr, onlyMerge: false
      });
      setSingleLog(res); setSingleStatus('success');
    } catch (e: any) { setSingleLog(e.toString()); setSingleStatus('error'); }
  };

  useEffect(() => { if (batchBootDir && batchAppDir) scanBatch(); }, [batchBootDir, batchAppDir]);

  const scanBatch = async () => {
    try {
      const bFiles = (await readDir(batchBootDir)).filter(e => e.name?.toLowerCase().endsWith('.bin') || e.name?.toLowerCase().endsWith('.hex')).map(e => ({ name: e.name, path: `${batchBootDir}\\${e.name}` }));
      const aFiles = (await readDir(batchAppDir)).filter(e => e.name?.toLowerCase().endsWith('.bin') || e.name?.toLowerCase().endsWith('.hex')).map(e => ({ name: e.name, path: `${batchAppDir}\\${e.name}` }));
      setBatchPairs(autoMatchFiles(bFiles, aFiles));
    } catch (e) { console.error(e); }
  };

  const runBatch = async () => {
    if (batchPairs.length === 0) return;
    setBatchStatus('running'); setProcessedCount(0);
    const outDir = `${batchAppDir}\\Merged_Output`;
    const newPairs = [...batchPairs];
    for (let i = 0; i < newPairs.length; i++) {
      const p = newPairs[i];
      const out = `${outDir}\\${p.outName}`;
      try {
        await invoke('execute_merge_and_flash', {
          jflashPath: jflashExe, projectPath: jflashPrj,
          bootPath: p.boot.path, appPath: p.app.path, outputPath: out, bootAddr, appAddr, onlyMerge: true
        });
        p.status = 'success'; p.log = '✅ 生成成功';
      } catch (e: any) { p.status = 'error'; p.log = `❌ ${e}`; }
      setBatchPairs([...newPairs]); setProcessedCount(i + 1);
    }
    setBatchStatus('done');
  };

  return (
    <div className="h-screen bg-[#f8fafc] text-slate-600 font-sans flex flex-col relative overflow-hidden">
      
      {/* 🌸 梦幻背景光晕 */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-100/40 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-pink-100/40 rounded-full blur-[120px] pointer-events-none" />

      {/* 🧭 导航栏 */}
      <div className="px-8 py-6 z-10 flex justify-between items-center bg-white/50 backdrop-blur-sm border-b border-white/50">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-blue-400 to-indigo-500 p-2.5 rounded-xl shadow-lg shadow-blue-200">
            <Cpu className="text-white w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-slate-700 tracking-tight">Flash Master</h1>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
              <p className="text-[10px] font-bold text-slate-400">READY TO MERGE</p>
            </div>
          </div>
        </div>

        <div className="bg-slate-100/50 p-1.5 rounded-2xl border border-white flex gap-2">
          <button onClick={() => setMode('single')} className={clsx("px-6 py-2 rounded-xl text-xs font-bold transition-all duration-300", mode === 'single' ? "bg-white text-blue-600 shadow-sm" : "text-gray-400 hover:text-gray-600")}>单文件</button>
          <button onClick={() => setMode('batch')} className={clsx("px-6 py-2 rounded-xl text-xs font-bold transition-all duration-300", mode === 'batch' ? "bg-white text-pink-500 shadow-sm" : "text-gray-400 hover:text-gray-600")}>批量处理</button>
        </div>

        <button onClick={() => setShowSettings(true)} className="p-3 bg-white rounded-2xl border border-slate-100 text-slate-400 hover:text-blue-500 hover:rotate-90 hover:scale-110 transition-all shadow-sm">
          <Settings size={20} />
        </button>
      </div>

      {/* 🚀 主舞台 */}
      <div className="flex-1 flex items-center justify-center p-6 z-10">
        
        {/* 单文件模式 */}
        {mode === 'single' && (
          <div className="w-full max-w-lg bg-white/60 backdrop-blur-xl rounded-[2.5rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white p-8 animate-in zoom-in-95 duration-500 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-300 via-pink-300 to-purple-300 opacity-50"></div>
            
            <div className="space-y-6 mt-2">
              <JellyInput label="BOOTLOADER" value={bootPath} onClick={() => handleSelect('boot')} icon={Layers} theme="blue" />
              <div className="flex justify-center -my-3 z-0 opacity-30"><ArrowRight className="text-slate-300 rotate-90" size={20} /></div>
              <JellyInput label="APPLICATION" value={appPath} onClick={() => handleSelect('app')} icon={Zap} theme="pink" />
              <div className="flex justify-center -my-3 z-0 opacity-30"><ArrowRight className="text-slate-300 rotate-90" size={20} /></div>
              <JellyInput label="OUTPUT HEX" value={outPath} onClick={() => handleSelect('out', false, true)} icon={Save} theme="purple" />

              <button 
                onClick={runSingle}
                disabled={singleStatus === 'running'}
                className={clsx(
                  "w-full h-14 mt-6 rounded-2xl font-bold text-white shadow-xl shadow-blue-200/50 transition-all active:scale-95 flex items-center justify-center gap-2",
                  singleStatus === 'running' ? "bg-slate-300 cursor-not-allowed" : "bg-gradient-to-r from-blue-400 to-indigo-500 hover:brightness-110"
                )}
              >
                {singleStatus === 'running' ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {singleStatus === 'running' ? "正在施法..." : "合并并烧录"}
              </button>

              <div className={clsx("p-4 rounded-2xl text-xs font-mono border min-h-[60px] flex items-center gap-3 transition-colors", 
                singleStatus === 'error' ? "bg-red-50 text-red-500 border-red-100" : 
                singleStatus === 'success' ? "bg-green-50 text-green-600 border-green-100" : "bg-white/50 text-slate-400 border-white"
              )}>
                {singleStatus === 'error' && <AlertTriangle size={20} className="shrink-0"/>}
                {singleStatus === 'success' && <CheckCircle2 size={20} className="shrink-0"/>}
                <div className="break-all">{singleLog || "等待指令..."}</div>
              </div>
            </div>
          </div>
        )}

        {/* 批量模式 */}
        {mode === 'batch' && (
          <div className="w-full max-w-4xl bg-white/60 backdrop-blur-xl rounded-[2.5rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white p-8 h-[600px] flex flex-col animate-in zoom-in-95 duration-500 relative overflow-hidden">
             <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-pink-300 via-purple-300 to-blue-300 opacity-50"></div>

            <div className="grid grid-cols-2 gap-6 mb-6 mt-2">
              <JellyInput label="BOOT FOLDER" value={batchBootDir} onClick={() => handleSelect('b_boot', true)} icon={FolderOpen} theme="blue" />
              <JellyInput label="APP FOLDER" value={batchAppDir} onClick={() => handleSelect('b_app', true)} icon={FolderOpen} theme="pink" />
            </div>

            <div className="flex-1 bg-white/40 rounded-3xl border border-white overflow-hidden flex flex-col shadow-inner">
              <div className="px-6 py-3 bg-white/40 border-b border-white flex justify-between text-xs font-bold text-slate-400 uppercase tracking-wider">
                <span>自动匹配列表 ({batchPairs.length})</span>
                <span className={batchStatus === 'running' ? 'text-blue-500' : ''}>{batchStatus === 'running' ? `正在处理 ${processedCount}/${batchPairs.length}` : '就绪'}</span>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
                {batchPairs.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-3">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center animate-pulse"><Layers size={32} className="opacity-30" /></div>
                    <p className="font-bold text-xs">请选择文件夹以开始匹配</p>
                  </div>
                )}
                {batchPairs.map(p => (
                  <div key={p.id} className="bg-white p-4 rounded-2xl border border-slate-50 shadow-sm hover:shadow-md transition-all group">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex flex-col gap-1.5 text-xs font-mono">
                         <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 font-bold text-[10px]">BOOT</span>
                            <span className="text-slate-600 font-bold">{p.boot.name}</span>
                         </div>
                         <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-md bg-pink-50 text-pink-600 font-bold text-[10px]">APP</span>
                            <span className="text-slate-600 font-bold">{p.app.name}</span>
                         </div>
                      </div>
                      <div className="pl-4">
                        {p.status === 'success' && <div className="bg-green-100 text-green-600 p-1.5 rounded-full"><CheckCircle2 size={16} /></div>}
                        {p.status === 'error' && <div className="bg-red-100 text-red-500 p-1.5 rounded-full"><XCircle size={16} /></div>}
                        {p.status === 'pending' && <div className="w-2 h-2 bg-slate-200 rounded-full mx-2" />}
                      </div>
                    </div>
                    {p.log && (
                      <div className={clsx("text-[10px] p-2.5 rounded-xl border whitespace-pre-wrap font-mono mt-2 transition-colors", 
                        p.status === 'error' ? "text-red-500 border-red-100 bg-red-50/50" : "text-green-600 border-green-100 bg-green-50/50"
                      )}>
                        {p.log}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <button 
                onClick={runBatch}
                disabled={batchStatus === 'running' || batchPairs.length === 0}
                className={clsx(
                  "w-full h-12 mt-6 rounded-2xl font-bold text-white shadow-xl shadow-pink-200/50 transition-all active:scale-95 flex items-center justify-center gap-2",
                  batchStatus === 'running' ? "bg-slate-300 cursor-not-allowed" : "bg-gradient-to-r from-pink-400 to-purple-500 hover:brightness-110"
                )}
              >
                {batchStatus === 'running' ? <Loader2 className="animate-spin" /> : <Layers />}
                {batchStatus === 'running' ? "批量生成中..." : "一键批量生成 HEX"}
            </button>
          </div>
        )}
      </div>

      {/* ⚙️ 设置弹窗 */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-400 to-purple-400"></div>
            <h2 className="text-lg font-bold text-slate-700 mb-6 flex items-center gap-2"><Settings size={20} className="text-blue-500" /> 全局配置</h2>
            
            <div className="space-y-4">
              <JellyInput label="J-FLASH EXE PATH" value={jflashExe} onClick={() => handleSelect('exe')} icon={Cpu} theme="blue" />
              <JellyInput label="PROJECT FILE (.jflash)" value={jflashPrj} onClick={() => handleSelect('prj')} icon={FileCog} theme="purple" />
              
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-[10px] font-bold text-slate-400 ml-2 mb-1 block">BOOT ADDR (0x)</label><input value={bootAddr} onChange={e=>setBootAddr(e.target.value)} className="w-full p-3 bg-slate-50 rounded-2xl border-none font-mono text-sm text-slate-600 focus:ring-2 ring-blue-200 outline-none transition-all" /></div>
                <div><label className="text-[10px] font-bold text-slate-400 ml-2 mb-1 block">APP ADDR (0x)</label><input value={appAddr} onChange={e=>setAppAddr(e.target.value)} className="w-full p-3 bg-slate-50 rounded-2xl border-none font-mono text-sm text-slate-600 focus:ring-2 ring-purple-200 outline-none transition-all" /></div>
              </div>
            </div>

            <div className="mt-8 flex justify-end">
              <button onClick={() => setShowSettings(false)} className="px-8 py-3 bg-slate-800 text-white rounded-2xl text-xs font-bold hover:bg-slate-900 transition-colors shadow-lg shadow-slate-200">完成设置</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;