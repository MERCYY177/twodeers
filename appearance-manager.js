/* 双人空间外观系统：独立配置，不覆盖原 appearanceColors / customCSS。 */
(function(){
  'use strict';
  if (window.__duoAppearanceManagerInstalled) return;
  window.__duoAppearanceManagerInstalled = true;
  const defaults = { mode:'system', palette:'sage', background:'soft', bubbleStyle:'soft' };
  const palettes = {
    sage:{name:'鼠尾草',light:{bg:'#f7f8f4',panel:'#ffffff',line:'#e4e8dd',text:'#293328',sub:'#788374',soft:'#eef2e9',accent:'#e7eee0',deep:'#647a4e',shadow:'0 10px 28px rgba(52,75,42,.08)',chat:'#fbfcf9',me:'#e9f0e2',other:'#ffffff',theme:'#7b965d',button:'#536b3b'},dark:{bg:'#151a15',panel:'#202820',line:'#303b30',text:'#edf3e9',sub:'#a0ad9a',soft:'#283328',accent:'#344432',deep:'#b7c99f',shadow:'0 10px 28px rgba(0,0,0,.28)',chat:'#171e18',me:'#344632',other:'#252e25',theme:'#a6c386',button:'#647e4d'}},
    ocean:{name:'海洋蓝',light:{bg:'#f3f8fc',panel:'#ffffff',line:'#dce7f0',text:'#233647',sub:'#71859a',soft:'#eaf2f8',accent:'#e2eef7',deep:'#39779f',shadow:'0 10px 28px rgba(40,94,130,.09)',chat:'#f7fbfe',me:'#e0f0fa',other:'#ffffff',theme:'#397fa8',button:'#2c6d96'},dark:{bg:'#111b24',panel:'#1a2935',line:'#2b3d4c',text:'#e9f2f8',sub:'#9aafbe',soft:'#223747',accent:'#2c4b61',deep:'#a7d1eb',shadow:'0 10px 28px rgba(0,0,0,.3)',chat:'#14212b',me:'#294b60',other:'#22313e',theme:'#79b9dd',button:'#316f94'}},
    lavender:{name:'薰衣草',light:{bg:'#f8f6fc',panel:'#ffffff',line:'#e6def0',text:'#332a40',sub:'#877b98',soft:'#f0eaf7',accent:'#eee5f8',deep:'#8065a0',shadow:'0 10px 28px rgba(99,68,133,.09)',chat:'#fcfaff',me:'#eee5f7',other:'#ffffff',theme:'#8d70ad',button:'#745790'},dark:{bg:'#1b1722',panel:'#282131',line:'#3b304a',text:'#f2edf8',sub:'#b1a4c0',soft:'#332940',accent:'#49375e',deep:'#d1b7ec',shadow:'0 10px 28px rgba(0,0,0,.3)',chat:'#201a29',me:'#48365b',other:'#30273b',theme:'#c4a1e1',button:'#765b91'}},
    rose:{name:'樱花粉',light:{bg:'#fff7f8',panel:'#ffffff',line:'#f0dfe4',text:'#3d2d32',sub:'#987f87',soft:'#f9edf0',accent:'#f8e6eb',deep:'#b36f83',shadow:'0 10px 28px rgba(156,85,105,.08)',chat:'#fffafb',me:'#f9e8ed',other:'#ffffff',theme:'#c17d91',button:'#a85f76'},dark:{bg:'#21171b',panel:'#302127',line:'#4a3039',text:'#f6edf0',sub:'#bea2ac',soft:'#3a2730',accent:'#51313f',deep:'#e4b1c0',shadow:'0 10px 28px rgba(0,0,0,.3)',chat:'#25191f',me:'#533440',other:'#382830',theme:'#d99bad',button:'#9a586e'}},
    forest:{name:'森林绿',light:{bg:'#f4f8f4',panel:'#ffffff',line:'#dce8de',text:'#25362b',sub:'#738779',soft:'#e9f1e9',accent:'#dfece1',deep:'#4f7859',shadow:'0 10px 28px rgba(45,91,57,.09)',chat:'#f8fcf8',me:'#e0eee2',other:'#ffffff',theme:'#5f8b67',button:'#426d4b'},dark:{bg:'#121c16',panel:'#1d2a21',line:'#2d4032',text:'#eaf3ec',sub:'#9db3a2',soft:'#25382b',accent:'#304c37',deep:'#b2d4b8',shadow:'0 10px 28px rgba(0,0,0,.3)',chat:'#162219',me:'#2e4b35',other:'#243228',theme:'#8fbd98',button:'#4e7f59'}},
    sunset:{name:'日落橘',light:{bg:'#fff8f2',panel:'#ffffff',line:'#f0e1d3',text:'#3d3027',sub:'#988272',soft:'#f7eee5',accent:'#fae9d8',deep:'#b57643',shadow:'0 10px 28px rgba(152,95,45,.08)',chat:'#fffbf7',me:'#f8e9db',other:'#ffffff',theme:'#c18450',button:'#9c6337'},dark:{bg:'#211a15',panel:'#30251d',line:'#49372b',text:'#f6eee7',sub:'#bda995',soft:'#3b2e23',accent:'#523b2a',deep:'#e4b58b',shadow:'0 10px 28px rgba(0,0,0,.3)',chat:'#251c16',me:'#513a2a',other:'#382c23',theme:'#dda875',button:'#94613c'}},
    oceanTeal:{name:'薄荷青',light:{bg:'#f2faf9',panel:'#ffffff',line:'#d8ebe8',text:'#243a38',sub:'#718b87',soft:'#e7f3f1',accent:'#dff1ee',deep:'#3e827b',shadow:'0 10px 28px rgba(42,112,105,.08)',chat:'#f8fdfc',me:'#def1ed',other:'#ffffff',theme:'#4c938a',button:'#34776f'},dark:{bg:'#12201f',panel:'#1d302e',line:'#2c4845',text:'#e9f5f3',sub:'#9ebcb7',soft:'#25413e',accent:'#315650',deep:'#a4d9d0',shadow:'0 10px 28px rgba(0,0,0,.3)',chat:'#162624',me:'#2d514b',other:'#243936',theme:'#78bdb3',button:'#397d75'}},
    mono:{name:'黑白灰',light:{bg:'#f5f5f5',panel:'#ffffff',line:'#e1e1e1',text:'#202020',sub:'#777777',soft:'#eeeeee',accent:'#e6e6e6',deep:'#555555',shadow:'0 10px 28px rgba(0,0,0,.07)',chat:'#fafafa',me:'#e9e9e9',other:'#ffffff',theme:'#777777',button:'#333333'},dark:{bg:'#141414',panel:'#222222',line:'#373737',text:'#f2f2f2',sub:'#a0a0a0',soft:'#2c2c2c',accent:'#3a3a3a',deep:'#dddddd',shadow:'0 10px 28px rgba(0,0,0,.35)',chat:'#191919',me:'#3a3a3a',other:'#292929',theme:'#c0c0c0',button:'#555555'}},
    cream:{name:'奶油米白',light:{bg:'#fbf8f1',panel:'#fffdf8',line:'#ebe3d5',text:'#383127',sub:'#918675',soft:'#f3eee4',accent:'#eee4d4',deep:'#8b7653',shadow:'0 10px 28px rgba(113,91,54,.08)',chat:'#fffdf8',me:'#f1e9dc',other:'#fffefa',theme:'#a38b63',button:'#786345'},dark:{bg:'#1c1914',panel:'#2b261e',line:'#40392d',text:'#f3eee4',sub:'#b9ad98',soft:'#373024',accent:'#4c402c',deep:'#dec89e',shadow:'0 10px 28px rgba(0,0,0,.32)',chat:'#211d16',me:'#493e2c',other:'#332d23',theme:'#ccb184',button:'#846d48'}}
  };
  let mediaQuery=null;
  function normalize(){
    const saved=state.appearanceSettings&&typeof state.appearanceSettings==='object'?state.appearanceSettings:{};
    state.appearanceSettings={...defaults,...saved};
    if(!['system','light','dark'].includes(state.appearanceSettings.mode))state.appearanceSettings.mode='system';
    if(!palettes[state.appearanceSettings.palette])state.appearanceSettings.palette='sage';
    if(!['soft','plain','gradient'].includes(state.appearanceSettings.background))state.appearanceSettings.background='soft';
    if(!['soft','classic','flat'].includes(state.appearanceSettings.bubbleStyle))state.appearanceSettings.bubbleStyle='soft';
  }
  function apply(saveNow){
    normalize();
    const cfg=state.appearanceSettings;
    const dark=cfg.mode==='dark'||(cfg.mode==='system'&&!!(mediaQuery&&mediaQuery.matches));
    const p=palettes[cfg.palette][dark?'dark':'light'];
    const root=document.documentElement;
    root.dataset.duoThemeMode=cfg.mode;
    root.dataset.duoThemeResolved=dark?'dark':'light';
    root.dataset.duoPalette=cfg.palette;
    root.style.colorScheme=dark?'dark':'light';
    const vars={'--bg':p.bg,'--panel':p.panel,'--line':p.line,'--text':p.text,'--sub':p.sub,'--soft':p.soft,'--accent':p.accent,'--accent-deep':p.deep,'--shadow':p.shadow,'--chat-bg':p.chat,'--bubble-me':p.me,'--bubble-other':p.other};
    // Keep the existing custom accent/button fields authoritative; these are legacy user settings.
    vars['--theme-color']=normalizeHex(state.appearanceColors?.theme)||p.theme;
    vars['--button-bg']=normalizeHex(state.appearanceColors?.buttonBg)||p.button;
    vars['--button-text']=normalizeHex(state.appearanceColors?.buttonText)||'#ffffff';
    const css=':root{'+Object.entries(vars).map(([k,v])=>k+':'+v).join(';')+'}'+(cfg.background==='gradient'?'.app{background:linear-gradient(145deg,'+p.bg+','+p.soft+')}': '');
    let style=document.getElementById('duoAppearanceThemeStyle');
    if(!style){style=document.createElement('style');style.id='duoAppearanceThemeStyle';document.head.appendChild(style);}
    style.textContent=css;
    // Keep the user's existing custom CSS later in cascade than the theme tokens.
    const custom=document.getElementById('customStyle');
    if(custom&&custom.parentNode===document.head)document.head.appendChild(custom);
    const host=document.getElementById('circleMount');
    if(host){
      const circleVars={'--bg':p.bg,'--card':p.panel,'--line':p.line,'--text':p.text,'--sub':p.sub,'--main':p.deep,'--pill':p.soft,'--soft':p.soft,'--input':p.chat,'--shadow':p.shadow,'--social-bg':p.bg,'--social-border':p.line,'--pink':p.accent,'--glass':dark?'rgba(20,25,22,.65)':'rgba(255,255,255,.30)'};
      Object.entries(circleVars).forEach(([k,v])=>host.style.setProperty(k,v));
    }
    document.body.classList.toggle('duo-bubble-flat',cfg.bubbleStyle==='flat');
    document.body.classList.toggle('duo-bubble-classic',cfg.bubbleStyle==='classic');
    const mode=document.getElementById('duoThemeMode');if(mode)mode.value=cfg.mode;
    const bg=document.getElementById('duoBackgroundMode');if(bg)bg.value=cfg.background;
    const bubble=document.getElementById('duoBubbleStyle');if(bubble)bubble.value=cfg.bubbleStyle;
    document.querySelectorAll('[data-duo-palette]').forEach(el=>{const active=el.dataset.duoPalette===cfg.palette;el.classList.toggle('active',active);el.setAttribute('aria-pressed',active?'true':'false');});
    if(saveNow&&typeof save==='function')save();
  }
  function addPanel(){
    const target=document.getElementById('settingsParam');if(!target||document.getElementById('duoAppearancePanel'))return;
    const card=document.createElement('section');card.className='panel-card duo-appearance-panel';card.id='duoAppearancePanel';
    card.innerHTML='<h3>主题与配色</h3><div class="field"><label for="duoThemeMode">显示模式</label><select id="duoThemeMode"><option value="system">跟随系统</option><option value="light">浅色模式</option><option value="dark">深色模式</option></select></div><div class="field"><label>配色方案（点击即时预览）</label><div class="duo-palette-grid" id="duoPaletteGrid"></div></div><div class="two-col"><div class="field"><label for="duoBackgroundMode">页面背景</label><select id="duoBackgroundMode"><option value="soft">柔和纯色</option><option value="plain">简洁纯色</option><option value="gradient">轻柔渐变</option></select></div><div class="field"><label for="duoBubbleStyle">聊天气泡</label><select id="duoBubbleStyle"><option value="soft">柔和</option><option value="classic">经典</option><option value="flat">扁平</option></select></div></div><div class="duo-theme-preview"><div class="duo-preview-top">双人空间 · 主题预览</div><div class="duo-preview-bubbles"><span>今天也要开心。</span><b>有你就很好。</b></div></div><p class="data-note">主题选择保存在本机；切换浅色、深色或系统模式会同步主页面与 Circle。原有自定义颜色和 CSS 继续保留。</p>';
    target.insertBefore(card,target.firstElementChild);
    const grid=card.querySelector('#duoPaletteGrid');
    Object.entries(palettes).forEach(([id,p])=>{const btn=document.createElement('button');btn.type='button';btn.className='duo-palette-option';btn.dataset.duoPalette=id;btn.innerHTML='<span class="duo-palette-dots"><i></i><i></i><i></i></span><span>'+p.name+'</span>';btn.querySelectorAll('i').forEach((dot,index)=>dot.style.background=[p.light.theme,p.light.me,p.light.bg][index]);grid.appendChild(btn);});
    grid.addEventListener('click',e=>{const b=e.target.closest('[data-duo-palette]');if(!b)return;state.appearanceSettings.palette=b.dataset.duoPalette;apply(true);});
    card.querySelector('#duoThemeMode').addEventListener('change',e=>{state.appearanceSettings.mode=e.target.value;apply(true);});
    card.querySelector('#duoBackgroundMode').addEventListener('change',e=>{state.appearanceSettings.background=e.target.value;apply(true);});
    card.querySelector('#duoBubbleStyle').addEventListener('change',e=>{state.appearanceSettings.bubbleStyle=e.target.value;apply(true);});
    const style=document.createElement('style');style.id='duoAppearancePanelStyle';style.textContent='.duo-palette-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.duo-palette-option{display:flex;align-items:center;gap:7px;padding:10px 8px;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--text);font-size:12px}.duo-palette-option.active{outline:2px solid var(--theme-color);border-color:var(--theme-color)}.duo-palette-dots{display:flex;gap:2px}.duo-palette-dots i{width:10px;height:20px;border-radius:5px;display:block}.duo-theme-preview{margin-top:12px;padding:12px;border:1px solid var(--line);border-radius:14px;background:var(--chat-bg)}.duo-preview-top{font-size:12px;color:var(--sub);margin-bottom:10px}.duo-preview-bubbles{display:flex;flex-direction:column;gap:8px}.duo-preview-bubbles span,.duo-preview-bubbles b{max-width:82%;padding:9px 12px;border-radius:13px;background:var(--bubble-other);font-size:13px;color:var(--text)}.duo-preview-bubbles b{align-self:flex-end;background:var(--bubble-me);font-weight:600}body.duo-bubble-flat .bubble{box-shadow:none!important;border-radius:8px!important}body.duo-bubble-classic .bubble{box-shadow:0 2px 8px rgba(0,0,0,.06)}';
    document.head.appendChild(style);
  }
  function boot(){
    normalize();
    addPanel();
    try{mediaQuery=window.matchMedia('(prefers-color-scheme: dark)');mediaQuery.addEventListener?.('change',()=>{if(state.appearanceSettings.mode==='system')apply(false);});}catch(_){}
    apply(false);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.DuoAppearance={apply,palettes};
})();