@import "tailwindcss";

@theme {
  --color-bg: #030712;       /* 深邃黑蓝 */
  --color-panel: #111827;    /* 面板灰蓝 */
  --color-input: #1f2937;    /* 输入框背景 */
  --color-border: #374151;   /* 边框颜色 */
  --color-primary: #06b6d4;  /* 赛博蓝 */
  --color-primary-glow: #06b6d4;
  --color-success: #10b981;
  --color-error: #ef4444;
  
  --font-mono: "JetBrains Mono", "Fira Code", monospace;
}

/* 全局样式调整 */
body {
  background-color: var(--color-bg);
  color: #e2e8f0;
  font-family: 'Segoe UI', sans-serif;
  overflow: hidden;
  user-select: none;
}

/* 自定义滚动条 */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }

/* 霓虹发光效果工具类 */
.glow-text {
  text-shadow: 0 0 10px var(--color-primary-glow);
}
.glow-box {
  box-shadow: 0 0 15px -3px var(--color-primary-glow);
}