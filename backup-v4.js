/* 双人空间 V4 ZIP 备份：无压缩 ZIP + 分块 SHA-256 / CRC32 + v3 JSON 兼容。 */
(function(){
  'use strict';
  if(window.__duoBackupV4Installed)return;
  window.__duoBackupV4Installed=true;
  const MAX_ARCHIVE=1024*1024*1024, MAX_JSON_MEMBER=128*1024*1024, MAX_MANIFEST=16*1024*1024, CHUNK=1024*1024;
  const enc=new TextEncoder(), dec=new TextDecoder('utf-8',{fatal:true});
  const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}return t;})();
  class Sha256{
    constructor(){this.h=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);this.buf=new Uint8Array(64);this.used=0;this.bytes=0;this.k=Sha256.K;}
    update(input){const a=input instanceof Uint8Array?input:new Uint8Array(input);let p=0;this.bytes+=a.length;if(this.used){const n=Math.min(64-this.used,a.length);this.buf.set(a.subarray(0,n),this.used);this.used+=n;p=n;if(this.used===64){this.block(this.buf);this.used=0;}}while(p+64<=a.length){this.block(a.subarray(p,p+64));p+=64;}if(p<a.length){this.buf.set(a.subarray(p),0);this.used=a.length-p;}return this;}
    block(b){const w=new Uint32Array(64),v=this.h;for(let i=0;i<16;i++)w[i]=((b[i*4]<<24)|(b[i*4+1]<<16)|(b[i*4+2]<<8)|b[i*4+3])>>>0;for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2],s0=((x>>>7)|(x<<25))^((x>>>18)|(x<<14))^(x>>>3),s1=((y>>>17)|(y<<15))^((y>>>19)|(y<<13))^(y>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;}let [a,c,d,e,f,g,h,j]=v;for(let i=0;i<64;i++){const S1=((f>>>6)|(f<<26))^((f>>>11)|(f<<21))^((f>>>25)|(f<<7)),ch=(f&g)^(~f&h),t1=(j+S1+ch+this.k[i]+w[i])>>>0,S0=((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10)),maj=(a&c)^(a&d)^(c&d),t2=(S0+maj)>>>0;j=h;h=g;g=f;f=(e+t1)>>>0;e=d;d=c;c=a;a=(t1+t2)>>>0;}const z=[a,c,d,e,f,g,h,j];for(let i=0;i<8;i++)v[i]=(v[i]+z[i])>>>0;}
    digest(){const bits=this.bytes*8,hi=Math.floor(bits/0x100000000),lo=bits>>>0;this.buf[this.used++]=0x80;if(this.used>56){this.buf.fill(0,this.used);this.block(this.buf);this.used=0;}this.buf.fill(0,this.used,56);const dv=new DataView(this.buf.buffer);dv.setUint32(56,hi,false);dv.setUint32(60,lo,false);this.block(this.buf);const out=new Uint8Array(32),view=new DataView(out.buffer);for(let i=0;i<8;i++)view.setUint32(i*4,this.h[i],false);return out;}
  }
  Sha256.K=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  function hex(a){return Array.from(a,x=>x.toString(16).padStart(2,'0')).join('');}
  async function inspectBlob(blob){const sh=new Sha256();let crc=0xffffffff;const feed=b=>{sh.update(b);for(let i=0;i<b.length;i++)crc=CRC_TABLE[(crc^b[i])&255]^(crc>>>8);};if(blob.stream){const reader=blob.stream().getReader();for(;;){const r=await reader.read();if(r.done)break;feed(r.value);}}else{for(let p=0;p<blob.size;p+=CHUNK)feed(new Uint8Array(await blob.slice(p,p+CHUNK).arrayBuffer()));}return {sha256:hex(sh.digest()),crc32:((crc^0xffffffff)>>>0).toString(16).padStart(8,'0')};}
  function u16(n){return new Uint8Array([n&255,(n>>>8)&255]);}
  function u32(n){return new Uint8Array([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]);}
  function localHeader(name,size,crc){const n=enc.encode(name),h=new Uint8Array(30);const d=new DataView(h.buffer);d.setUint32(0,0x04034b50,true);d.setUint16(4,20,true);d.setUint16(6,0x0800,true);d.setUint16(8,0,true);d.setUint16(10,0,true);d.setUint16(12,0x21,true);d.setUint32(14,crc,true);d.setUint32(18,size,true);d.setUint32(22,size,true);d.setUint16(26,n.length,true);d.setUint16(28,0,true);return [h,n];}
  function centralHeader(name,size,crc,offset){const n=enc.encode(name),h=new Uint8Array(46),d=new DataView(h.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x0800,true);d.setUint16(10,0,true);d.setUint16(12,0,true);d.setUint16(14,0x21,true);d.setUint32(16,crc,true);d.setUint32(20,size,true);d.setUint32(24,size,true);d.setUint16(28,n.length,true);d.setUint16(30,0,true);d.setUint16(32,0,true);d.setUint16(34,0,true);d.setUint16(36,0,true);d.setUint32(38,0,true);d.setUint32(42,offset,true);return [h,n];}
  function safePath(path){
    if(typeof path!=='string'||!path||path.length>=1024||path.startsWith('/')||path.includes('\\')||/[\u0000-\u001f\u007f:?*<>"|#]/.test(path))return false;
    const parts=path.split('/');
    if(parts.some(part=>!part||part==='.'||part==='..'))return false;
    for(const part of parts){
      try{const decoded=decodeURIComponent(part);if(decoded==='.'||decoded==='..'||/[\/\\\u0000-\u001f\u007f]/.test(decoded))return false;}catch(_){return false;}
    }
    return enc.encode(path).length<=65535;
  }
  function safeBuiltinStickerPath(value){
    if(typeof value!=='string'||!value.startsWith('assets/builtin-stickers/')||/[\\\u0000-\u001f\u007f\"'<>?#]/.test(value))return false;
    const parts=value.split('/');
    if(parts.some(part=>!part||part==='.'||part==='..'))return false;
    try{return !parts.some(part=>{const decoded=decodeURIComponent(part);return decoded==='.'||decoded==='..'||/[\\/\u0000-\u001f\u007f]/.test(decoded);});}catch(_){return false;}
  }
  async function makeZip(entries){
    if(!Array.isArray(entries)||entries.length>65534)throw new Error('备份条目数量超过 ZIP 限制');
    let total=0,offset=0;const parts=[],central=[],resources=[],seen=new Set();
    for(const e of entries){
      if(!e||!(e.blob instanceof Blob)||!safePath(e.path)||e.path==='manifest.json'||seen.has(e.path))throw new Error('备份资源路径无效、重复或保留');
      seen.add(e.path);
      if(e.blob.size>0xffffffff)throw new Error('单项资源超过 ZIP32 限制');
      total+=e.blob.size;if(!Number.isSafeInteger(total)||total>MAX_ARCHIVE)throw new Error('备份资源合计超过 1 GB 限制');
      const h=await inspectBlob(e.blob),name=e.path;
      const meta={path:name,size:e.blob.size,crc32:h.crc32,sha256:h.sha256,type:e.type||'file',mimeType:e.mimeType||e.blob.type||'application/octet-stream'};
      for(const k of ['id','name','kind','format','createdAt'])if(e[k]!==undefined)meta[k]=e[k];
      resources.push(meta);
      const [lh,ln]=localHeader(name,e.blob.size,parseInt(h.crc32,16)>>>0);
      parts.push(lh,ln,e.blob);
      const [ch,cn]=centralHeader(name,e.blob.size,parseInt(h.crc32,16)>>>0,offset);central.push(ch,cn);
      offset+=lh.length+ln.length+e.blob.size;if(offset>0xffffffff)throw new Error('备份总长度超过 ZIP32 4 GB 偏移范围');
    }
    const manifest={format:'twodeers-backup',formatVersion:4,kind:window.__duoBackupKind||'all',createdAt:new Date().toISOString(),resourceCount:resources.length,totalResourceBytes:total,hashAlgorithm:'SHA-256',checksumAlgorithm:'CRC-32',compression:'store',fontsCurrentId:window.__duoBackupFontCurrentId||null,resources};
    const manifestText=JSON.stringify(manifest,null,2);
    if(enc.encode(manifestText).length>MAX_MANIFEST)throw new Error('备份清单超过 16 MB 限制');
    const mb=new Blob([manifestText],{type:'application/json'}),mh=await inspectBlob(mb);
    const [lh,ln]=localHeader('manifest.json',mb.size,parseInt(mh.crc32,16)>>>0);parts.push(lh,ln,mb);
    const mo=offset;offset+=lh.length+ln.length+mb.size;if(offset>0xffffffff)throw new Error('备份总长度超过 ZIP32 4 GB 偏移范围');
    const [ch,cn]=centralHeader('manifest.json',mb.size,parseInt(mh.crc32,16)>>>0,mo);central.push(ch,cn);
    const centralSize=central.reduce((n,x)=>n+x.length,0);if(centralSize>64*1024*1024)throw new Error('备份中央目录超过 64 MB 限制');
    if(offset+centralSize+22>MAX_ARCHIVE)throw new Error('生成后的备份 ZIP 超过 1 GB 上限');
    const eocd=new Uint8Array(22),d=new DataView(eocd.buffer);d.setUint32(0,0x06054b50,true);d.setUint16(8,entries.length+1,true);d.setUint16(10,entries.length+1,true);d.setUint32(12,centralSize,true);d.setUint32(16,offset,true);d.setUint16(20,0,true);parts.push(...central,eocd);
    return new Blob(parts,{type:'application/zip'});
  }
  function jsonBlob(value){const blob=new Blob([JSON.stringify(value)],{type:'application/json;charset=utf-8'});if(blob.size>MAX_JSON_MEMBER)throw new Error('备份 JSON 数据文件超过 128 MB 限制');return blob;}
  async function buildV4Internal(kind){
    if(!['all','chat','param'].includes(kind))throw new Error('不支持的备份类型');
    if(kind!=='chat'){
      if(!window.__duoMailbox||typeof window.__duoMailbox.exportData!=='function')throw new Error('信件模块不可用，无法生成完整参数/总备份');
      if(!window.__duoCardSystem||typeof window.__duoCardSystem.exportData!=='function')throw new Error('字卡模块不可用，无法生成完整参数/总备份');
      if(!window.ChuanXunFontManager||typeof window.ChuanXunFontManager.exportData!=='function')throw new Error('字体模块不可用，无法生成完整参数/总备份');
    }
    const stateSnapshot=JSON.parse(JSON.stringify(state));
    const circleSnapshot=kind==='chat'?{}:JSON.parse(JSON.stringify(getCircleState()||{}));
    const mailboxSnapshot=kind!=='chat'?window.__duoMailbox.exportData():null;
    const cardSnapshot=kind!=='chat'?window.__duoCardSystem.exportData():null;
    const entries=[];let stateData={},mediaIds=[];
    const mailboxMediaIds=new Set();
    if(mailboxSnapshot){const mailbox=mailboxSnapshot.mailbox||mailboxSnapshot;for(const letter of mailbox.items||[])for(const image of letter.images||[])if(image&&image.id)mailboxMediaIds.add(image.id);for(const draft of mailboxSnapshot.drafts||[])for(const image of draft.images||[])if(image&&image.id)mailboxMediaIds.add(image.id);}
    if(kind==='all'){stateData={state:stateSnapshot};mediaIds=[...new Set([...(stateSnapshot.chatHistory||[]),...(stateSnapshot.stickers||[])].filter(x=>x&&x.mediaId).map(x=>x.mediaId).concat([...mailboxMediaIds]))];}
    else if(kind==='chat'){
      const ids=new Set((stateSnapshot.chatHistory||[]).filter(m=>m.mediaId).map(m=>m.mediaId));(stateSnapshot.stickers||[]).forEach(x=>{if(x.mediaId)ids.add(x.mediaId);});mediaIds=[...ids];
      stateData={chatHistory:stateSnapshot.chatHistory,stickers:stateSnapshot.stickers,stickerFavorites:stateSnapshot.stickerFavorites||[],stickerTombstones:stateSnapshot.stickerTombstones||[],media:{'avatar-me':stateSnapshot.media?.['avatar-me'],'avatar-other':stateSnapshot.media?.['avatar-other'],'bg-chat':stateSnapshot.media?.['bg-chat']},bubbleShape:stateSnapshot.bubbleShape,bubbleColors:stateSnapshot.bubbleColors,appearanceColors:stateSnapshot.appearanceColors,appearanceSettings:stateSnapshot.appearanceSettings,replyWindow:stateSnapshot.replyWindow,showReadReceipt:stateSnapshot.showReadReceipt,readReceiptStyle:stateSnapshot.readReceiptStyle||'text',typing:stateSnapshot.typing,offline:stateSnapshot.offline,callSettings:stateSnapshot.callSettings,incomingCallSettings:stateSnapshot.incomingCallSettings,chatBeautifyPresetId:stateSnapshot.chatBeautifyPresetId};
    }else if(kind==='param'){mediaIds=[...mailboxMediaIds];stateData={icons:stateSnapshot.icons,media:stateSnapshot.media,avatarShape:stateSnapshot.avatarShape,bubbleShape:stateSnapshot.bubbleShape,bubbleColors:stateSnapshot.bubbleColors,appearanceColors:stateSnapshot.appearanceColors,appearanceSettings:stateSnapshot.appearanceSettings,customCSS:stateSnapshot.customCSS,replyWindow:stateSnapshot.replyWindow,showReadReceipt:stateSnapshot.showReadReceipt,readReceiptStyle:stateSnapshot.readReceiptStyle||'text',typing:stateSnapshot.typing,offline:stateSnapshot.offline,cardPhrases:stateSnapshot.cardPhrases,callSettings:stateSnapshot.callSettings,incomingCallSettings:stateSnapshot.incomingCallSettings,chatBeautifyPresetId:stateSnapshot.chatBeautifyPresetId,cardUsageOutbox:stateSnapshot.cardUsageOutbox||[]};
    }
    entries.push({path:'state.json',blob:jsonBlob(stateData),type:'state'});
    if(kind==='all')entries.push({path:'circle-state.json',blob:jsonBlob(circleSnapshot),type:'circle-state'});
    if(kind==='param'){
      const circle=circleSnapshot;
      const circleSettings={};
      for(const key of ['myName','otherName','myAvatar','otherAvatar','myCover','otherCover','autoPost','postMin','postMax','replyMin','replyMax','uiFontScale','notificationsEnabled','nextOtherPostAt'])if(circle[key]!==undefined)circleSettings[key]=circle[key];
      entries.push({path:'circle-settings.json',blob:jsonBlob(circleSettings),type:'circle-settings'});
    }
    if(kind==='all'||kind==='param'){
      entries.push({path:'mailbox-data.json',blob:jsonBlob(mailboxSnapshot),type:'mailbox-data'});
      entries.push({path:'card-system.json',blob:jsonBlob(cardSnapshot),type:'card-system'});
    }
    for(const id of mediaIds){const rec=await getMediaRecord(id);if(!rec||!rec.blob)throw new Error('备份媒体缺失：'+id);entries.push({path:'media/'+encodeURIComponent(id)+'.blob',blob:rec.blob,type:'media',id:rec.id,kind:rec.kind,name:rec.name,mimeType:rec.mimeType,createdAt:rec.createdAt});}
    let fontsCurrentId=null;
    if(kind!=='chat'){const exported=await window.ChuanXunFontManager.exportData();fontsCurrentId=exported.currentFontId||null;const fontMeta=[];for(const f of exported.fonts||[]){if(!f.blob)throw new Error('字体文件缺失：'+f.id);const p='fonts/'+encodeURIComponent(f.id)+'.'+f.format;entries.push({path:p,blob:f.blob,type:'font',id:f.id,name:f.name,format:f.format,mimeType:f.mimeType,createdAt:f.createdAt});fontMeta.push({id:f.id,name:f.name,fileName:f.fileName,format:f.format,mimeType:f.mimeType,size:f.size,createdAt:f.createdAt,path:p});}entries.push({path:'font-library.json',blob:jsonBlob({currentFontId:fontsCurrentId,fonts:fontMeta}),type:'font-library'});}
    window.__duoBackupKind=kind;window.__duoBackupFontCurrentId=fontsCurrentId;
    try{return await makeZip(entries);}finally{delete window.__duoBackupKind;delete window.__duoBackupFontCurrentId;}
  }
  let exportInProgress=false;
  async function buildV4(kind){
    if(exportInProgress||window.__duoRestoreInProgress||window.__duoExportInProgress)throw new Error('当前已有备份导出或恢复任务正在执行');
    exportInProgress=true;window.__duoExportInProgress=true;let overlay=null;
    try{
      overlay=document.createElement('div');overlay.id='duoBackupOverlay';overlay.textContent='正在冻结数据并生成备份，请勿关闭页面…';overlay.style.cssText='position:fixed;inset:0;z-index:2147482000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(20,20,20,.68);color:#fff;font:600 15px/1.6 sans-serif;text-align:center;';document.body.appendChild(overlay);
      window.__duoCircleApi?.pauseTasks?.();window.__duoMailbox?.pauseTasks?.();
      return await buildV4Internal(kind);
    }finally{overlay?.remove();exportInProgress=false;window.__duoExportInProgress=false;window.__duoCircleApi?.resumeTasks?.();window.__duoMailbox?.resumeTasks?.();}
  }
  async function readJsonBlob(blob,path,maxBytes=MAX_JSON_MEMBER){if(!(blob instanceof Blob)||blob.size>maxBytes)throw new Error(path+' 超过 JSON 单文件读取上限（'+Math.floor(maxBytes/1024/1024)+' MB）');let text;try{text=await blob.text();return JSON.parse(text);}catch(error){if(error instanceof SyntaxError)throw new Error(path+' 不是有效 JSON');throw error;}}
  async function readJsonMember(map,path,maxBytes=MAX_JSON_MEMBER){const entry=map.get(path);if(!entry)throw new Error('缺少备份文件：'+path);if(entry.size>maxBytes)throw new Error(path+' 超过 JSON 单文件读取上限（'+Math.floor(maxBytes/1024/1024)+' MB）');return readJsonBlob(entry.blob,path,maxBytes);}
  function assertImportedObject(value,path){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(path+' 格式无效');}
  function assertImportedArray(value,path,max,objects=true){
    if(!Array.isArray(value)||value.length>max)throw new Error(path+' 数量或格式无效');
    if(objects&&value.some(item=>!item||typeof item!=='object'||Array.isArray(item)))throw new Error(path+' 包含无效条目');
  }
  function isSafeImportedUrl(raw){
    if(typeof raw!=='string'||!raw.trim())return true;
    const value=raw.trim();
    if(value.length>1400000000||/[\u0000-\u0020\\<>\"']/.test(value))return false;
    if(/^data:/i.test(value))return /^data:(?:image\/(?:png|jpe?g|webp|gif|avif)|video\/(?:mp4|webm)|audio\/(?:mpeg|mp3|ogg|wav|webm));base64,[a-z0-9+/=]+$/i.test(value);
    if(/^[a-z][a-z0-9+.-]*:/i.test(value)){
      try{const url=new URL(value);return (url.protocol==='http:'||url.protocol==='https:')&&!url.username&&!url.password;}catch(_){return false;}
    }
    if(value.startsWith('//'))return false;
    if(value.split(/[?#]/,1)[0].split('/').some(part=>part==='.'||part==='..'))return false;
    try{const url=new URL(value,'https://twodeers.invalid/');return url.origin==='https://twodeers.invalid'&&url.protocol==='https:';}catch(_){return false;}
  }
  function validateImportedUrls(value,path='备份',depth=0,budget={count:0}){
    if(value===null||value===undefined)return;
    if(++budget.count>500000||depth>40)throw new Error('备份数据结构过深或字段过多');
    if(Array.isArray(value)){value.forEach((item,index)=>validateImportedUrls(item,path+'['+index+']',depth+1,budget));return;}
    if(typeof value!=='object')return;
    for(const [key,item] of Object.entries(value)){
      if(key==='__proto__'||key==='prototype'||key==='constructor')throw new Error(path+'.'+key+' 包含禁止字段');
      const next=path+'.'+key;
      const urlField=/(?:src|url|href|avatar|cover|poster|asseturl|dataurl|image)/i.test(key)||/(?:^|\.)media(?:\.|$)/i.test(path);
      if(urlField&&typeof item==='string'&&item.trim()&&!isSafeImportedUrl(item))throw new Error(next+' 不是允许的媒体或网页地址');
      if(/^(?:text|content|title|name|alt|time|durationLabel|authorName|replyToName)$/i.test(key)&&typeof item==='string'&&item.length>200000)throw new Error(next+' 文本过长');
      if(item&&typeof item==='object')validateImportedUrls(item,next,depth+1,budget);
    }
  }
  async function validateV4Payloads(kind,map,data){
    const stateData=data.state||data;
    assertImportedObject(stateData,'state.json');
    for(const [key,max] of [['chatHistory',200000],['stickers',10000],['notifications',10000],['posts',50000],['stickerTombstones',10000]]){
      if(stateData[key]!==undefined)assertImportedArray(stateData[key],key,max,true);
    }
    for(const key of ['stickerFavorites','cardPhrases']){
      if(stateData[key]!==undefined&&(!Array.isArray(stateData[key])||stateData[key].length>50000||stateData[key].some(value=>typeof value!=='string'||value.length>1000)))throw new Error(key+' 字段格式无效');
    }
    if(Array.isArray(stateData.chatHistory))stateData.chatHistory.forEach((message,index)=>{
      if(message.id!==undefined&&(typeof message.id!=='string'||message.id.length>256||/[\u0000-\u001f\u007f]/.test(message.id)))throw new Error('聊天消息 ID 无效：'+index);
      for(const key of ['text','content','time','durationLabel'])if(message[key]!==undefined&&message[key]!==null&&(typeof message[key]!=='string'||message[key].length>(key==='time'||key==='durationLabel'?128:200000)))throw new Error('聊天消息文本无效：'+index+'/'+key);
      for(const key of ['sender','type'])if(message[key]!==undefined&&typeof message[key]!=='string')throw new Error('聊天消息类型字段无效：'+index+'/'+key);
      if(message.mediaId!==undefined&&message.mediaId!==null&&(typeof message.mediaId!=='string'||message.mediaId.length>256))throw new Error('聊天媒体 ID 无效：'+index);
    });
    if(Array.isArray(stateData.posts))stateData.posts.forEach((post,index)=>{
      if(post.id!==undefined&&(typeof post.id!=='string'||post.id.length>256||/[\u0000-\u001f\u007f]/.test(post.id)))throw new Error('朋友圈动态 ID 无效：'+index);
      if(post.text!==undefined&&(typeof post.text!=='string'||post.text.length>200000))throw new Error('朋友圈动态文本无效：'+index);
      if(post.ts!==undefined&&(!Number.isFinite(Number(post.ts))||Number(post.ts)<0))throw new Error('朋友圈动态时间无效：'+index);
      if(post.media!==undefined){assertImportedArray(post.media,'朋友圈媒体',9,true);}
      if(post.comments!==undefined){assertImportedArray(post.comments,'朋友圈评论',10000,true);post.comments.forEach((comment,j)=>{if(comment.id!==undefined&&(typeof comment.id!=='string'||comment.id.length>256))throw new Error('朋友圈评论 ID 无效：'+index+'/'+j);if(comment.text!==undefined&&(typeof comment.text!=='string'||comment.text.length>200000))throw new Error('朋友圈评论内容无效：'+index+'/'+j);});}
    });
    if(stateData.stickers)stateData.stickers.forEach((sticker,index)=>{
      if(sticker.id!==undefined&&(typeof sticker.id!=='string'||sticker.id.length>256))throw new Error('表情 ID 无效：'+index);
      if(sticker.mediaId!==undefined&&sticker.mediaId!==null&&(typeof sticker.mediaId!=='string'||sticker.mediaId.length>256))throw new Error('表情媒体 ID 无效：'+index);
      if(sticker.name!==undefined&&typeof sticker.name!=='string')throw new Error('表情名称无效：'+index);
      if(sticker.assetUrl!==undefined&&(sticker.source!=='builtin'||!safeBuiltinStickerPath(sticker.assetUrl)))throw new Error('内置表情资源地址无效：'+index);
    });
    if(kind!=='chat'){
      for(const path of ['mailbox-data.json','card-system.json','font-library.json'])if(!map.has(path))throw new Error('参数/总备份缺少必需模块文件：'+path);
      const mailbox=await readJsonMember(map,'mailbox-data.json');
      assertImportedObject(mailbox,'mailbox-data.json');
      const box=mailbox.mailbox||mailbox;
      assertImportedObject(box,'mailbox-data.json.mailbox');
      assertImportedArray(box.items===undefined?[]:box.items,'信件列表',5000,true);
      assertImportedArray(box.pending===undefined?[]:box.pending,'待处理信件',1000,true);
      assertImportedArray(mailbox.drafts===undefined?[]:mailbox.drafts,'信件草稿',5000,true);
      validateImportedUrls(mailbox,'mailbox-data.json');
      for(const letter of box.items||[]){
        for(const key of ['id','title','content'])if(letter[key]!==undefined&&typeof letter[key]!=='string')throw new Error('信件字段类型无效');
        if(letter.images!==undefined)assertImportedArray(letter.images,'信件图片',6,true);
        for(const image of letter.images||[])if(typeof image.id!=='string'||image.id.length>256)throw new Error('信件图片 ID 无效');
      }
      for(const draft of mailbox.drafts||[])if(draft.images!==undefined)assertImportedArray(draft.images,'草稿图片',6,true);
      const cards=await readJsonMember(map,'card-system.json');
      assertImportedObject(cards,'card-system.json');
      validateImportedUrls(cards,'card-system.json');
      for(const key of ['chatIds','chatTexts','momentsDynamicIds','momentsDynamicTexts','momentsReplyIds','momentsReplyTexts','appliedEventIds','momentsDynamic','momentsReply']){
        if(cards[key]!==undefined&&(!Array.isArray(cards[key])||cards[key].length>50000||cards[key].some(item=>typeof item!=='string'||item.length>1000)))throw new Error('字卡字段无效：'+key);
      }
      if(cards.recentDrawnRepliesV1!==undefined)assertImportedArray(cards.recentDrawnRepliesV1,'最近字卡记录',200,true);
      const fonts=await readJsonMember(map,'font-library.json');
      assertImportedObject(fonts,'font-library.json');
      validateImportedUrls(fonts,'font-library.json');
      assertImportedArray(fonts.fonts||[],'字体清单',500,true);
      for(const font of fonts.fonts||[]){
        if(typeof font.id!=='string'||font.id.length>256||typeof font.path!=='string'||!safePath(font.path)||!['ttf','otf','woff','woff2'].includes(String(font.format||'').toLowerCase()))throw new Error('字体元数据无效');
        if(!map.has(font.path))throw new Error('字体资源缺失：'+font.id);
      }
    }
    if(kind==='all'){
      if(!map.has('circle-state.json'))throw new Error('总备份缺少朋友圈状态文件');
      const circle=await readJsonMember(map,'circle-state.json');
      assertImportedObject(circle,'circle-state.json');
      if(window.__duoCircleApi?.validateState)window.__duoCircleApi.validateState(circle);
      validateImportedUrls(circle,'circle-state.json');
    }
    validateImportedUrls(data);
  }
  async function unzipStored(blob){
    if(!(blob instanceof Blob)||blob.size<22||blob.size>MAX_ARCHIVE)throw new Error('ZIP 文件为空、过小或超过 1 GB');
    const tailStart=Math.max(0,blob.size-65557),tail=new DataView(await blob.slice(tailStart).arrayBuffer());
    let eocd=-1;
    for(let p=tail.byteLength-22;p>=0;p--){if(tail.getUint32(p,true)===0x06054b50){eocd=p;break;}}
    if(eocd<0)throw new Error('ZIP 目录结束标记缺失');
    const disk=tail.getUint16(eocd+4,true),centralDisk=tail.getUint16(eocd+6,true),diskCount=tail.getUint16(eocd+8,true),count=tail.getUint16(eocd+10,true);
    const centralSize=tail.getUint32(eocd+12,true),centralOffset=tail.getUint32(eocd+16,true),commentLength=tail.getUint16(eocd+20,true);
    const eocdAbsolute=tailStart+eocd;
    if(disk!==0||centralDisk!==0||diskCount!==count||count<1||count>65535||commentLength!==0||eocd+22!==tail.byteLength||centralSize>64*1024*1024||centralOffset+centralSize!==eocdAbsolute)throw new Error('ZIP 目录边界、磁盘编号或条目数量无效');
    const cbuf=await blob.slice(centralOffset,centralOffset+centralSize).arrayBuffer(),dv=new DataView(cbuf),map=new Map(),ranges=[];
    let p=0;
    for(let i=0;i<count;i++){
      if(p+46>dv.byteLength||dv.getUint32(p,true)!==0x02014b50)throw new Error('ZIP 中央目录损坏');
      const flags=dv.getUint16(p+8,true),method=dv.getUint16(p+10,true),crc=dv.getUint32(p+16,true),size=dv.getUint32(p+20,true),usize=dv.getUint32(p+24,true);
      const nl=dv.getUint16(p+28,true),el=dv.getUint16(p+30,true),cl=dv.getUint16(p+32,true),diskStart=dv.getUint16(p+34,true),off=dv.getUint32(p+42,true);
      const entryEnd=p+46+nl+el+cl;
      if(entryEnd>dv.byteLength)throw new Error('ZIP 中央目录条目长度越界');
      if(diskStart!==0||flags!==0x0800||method!==0||size!==usize||size>MAX_ARCHIVE||off>=centralOffset)throw new Error('仅支持 UTF-8、未加密、无压缩且边界有效的安全 ZIP 备份');
      const name=dec.decode(new Uint8Array(cbuf,p+46,nl));
      if(!safePath(name)||map.has(name))throw new Error('ZIP 文件路径非法或重复：'+name);
      if(off+30>centralOffset)throw new Error('ZIP 本地文件头偏移越界：'+name);
      const localBuffer=await blob.slice(off,off+30).arrayBuffer();
      if(localBuffer.byteLength!==30)throw new Error('ZIP 本地文件头不完整：'+name);
      const local=new DataView(localBuffer);
      if(local.getUint32(0,true)!==0x04034b50)throw new Error('ZIP 本地文件头损坏：'+name);
      const lflags=local.getUint16(6,true),lmethod=local.getUint16(8,true),lcrc=local.getUint32(14,true),lsize=local.getUint32(18,true),lusize=local.getUint32(22,true),lnl=local.getUint16(26,true),lel=local.getUint16(28,true);
      if(lflags!==flags||lmethod!==method||lcrc!==crc||lsize!==size||lusize!==usize)throw new Error('ZIP 本地文件头与中央目录不一致：'+name);
      if(off+30+lnl+lel+size>centralOffset)throw new Error('ZIP 数据长度越界：'+name);
      const localName=dec.decode(new Uint8Array(await blob.slice(off+30,off+30+lnl).arrayBuffer()));
      if(localName!==name||lnl!==nl)throw new Error('ZIP 本地文件名与中央目录不一致：'+name);
      const dataStart=off+30+lnl+lel,dataEnd=dataStart+size;
      ranges.push([off,dataEnd,name]);
      map.set(name,{blob:blob.slice(dataStart,dataEnd),size,crc32:crc.toString(16).padStart(8,'0')});
      p=entryEnd;
    }
    if(p!==dv.byteLength)throw new Error('ZIP 中央目录包含未识别的尾随数据');
    ranges.sort((a,b)=>a[0]-b[0]);
    let archiveCursor=0;
    for(const range of ranges){if(range[0]<archiveCursor)throw new Error('ZIP 本地文件内容区域重叠：'+range[2]);if(range[0]!==archiveCursor)throw new Error('ZIP 本地文件区域之间存在未校验数据');archiveCursor=range[1];}
    if(archiveCursor!==centralOffset)throw new Error('ZIP 中央目录之前存在未校验数据');
    if(!map.has('manifest.json'))throw new Error('缺少 manifest.json');
    const manifest=await readJsonMember(map,'manifest.json',MAX_MANIFEST);
    if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||manifest.format!=='twodeers-backup'||manifest.formatVersion!==4||!['all','chat','param'].includes(manifest.kind)||!Array.isArray(manifest.resources))throw new Error('不是受支持的双人空间 V4 备份');
    if(manifest.resources.length!==map.size-1||manifest.resourceCount!==manifest.resources.length||manifest.resources.length>65534)throw new Error('manifest 资源数量与 ZIP 内容不一致');
    if(!Number.isSafeInteger(manifest.totalResourceBytes)||manifest.totalResourceBytes<0)throw new Error('manifest 总资源字节数字段无效');
    const declaredBytes=manifest.resources.reduce((n,x)=>n+(Number.isSafeInteger(x&&x.size)&&x.size>=0?x.size:NaN),0);
    if(!Number.isSafeInteger(declaredBytes)||declaredBytes!==manifest.totalResourceBytes||declaredBytes>MAX_ARCHIVE)throw new Error('manifest 总资源字节数与清单不一致或超出限制');
    const declaredPaths=new Set();
    for(const item of manifest.resources){
      if(!item||typeof item!=='object'||!safePath(item.path)||item.path==='manifest.json'||!map.has(item.path))throw new Error('备份缺少资源或资源路径非法：'+(item&&item.path||''));
      if(declaredPaths.has(item.path))throw new Error('manifest 存在重复资源路径：'+item.path);
      declaredPaths.add(item.path);
      if(!Number.isSafeInteger(item.size)||item.size<0||typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(item.sha256)||typeof item.crc32!=='string'||!/^[a-f0-9]{8}$/i.test(item.crc32))throw new Error('manifest 资源校验字段无效：'+item.path);
      const file=map.get(item.path);
      if(item.size!==file.size)throw new Error('资源字节数不匹配：'+item.path);
      const got=await inspectBlob(file.blob);
      if(got.sha256!==item.sha256||got.crc32!==item.crc32||got.crc32!==file.crc32)throw new Error('资源校验失败：'+item.path);
      file.meta=item;
    }
    for(const name of map.keys())if(name!=='manifest.json'&&!declaredPaths.has(name))throw new Error('ZIP 中存在未被 manifest 声明的资源：'+name);
    if(declaredPaths.size!==map.size-1)throw new Error('manifest 未完整覆盖 ZIP 资源');
    return {manifest,map};
  }
  async function restoreV4Internal(blob){
    const parsed=await unzipStored(blob),{manifest,map}=parsed,kind=manifest.kind;
    const data=await readJsonMember(map,'state.json');if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('state.json 格式无效');
    await validateV4Payloads(kind,map,data);
    if(kind==='all'||kind==='param'){
      for(const path of ['mailbox-data.json','card-system.json','font-library.json'])if(!map.has(path))throw new Error('参数/总备份缺少必需模块文件：'+path);
      if(!window.__duoMailbox||typeof window.__duoMailbox.importData!=='function')throw new Error('信件模块不可用，无法恢复此备份');
      if(!window.__duoCardSystem||typeof window.__duoCardSystem.importData!=='function')throw new Error('字卡模块不可用，无法恢复此备份');
      if(!window.ChuanXunFontManager||typeof window.ChuanXunFontManager.importData!=='function')throw new Error('字体模块不可用，无法恢复此备份');
      if(kind==='param'&&!Object.prototype.hasOwnProperty.call(data,'cardUsageOutbox'))throw new Error('参数备份缺少待投递聊天字卡记录');
      if(kind==='param'&&!map.has('circle-settings.json'))throw new Error('参数备份缺少 Circle 设置文件');
    }
    if(kind==='all'&&!map.has('circle-state.json'))throw new Error('总备份缺少独立的 Circle 状态文件');
    const mediaEntries=manifest.resources.filter(x=>x.type==='media'),fontEntries=manifest.resources.filter(x=>x.type==='font');
    const newMedia=new Map(),oldState=JSON.stringify(state),oldStorage=localStorage.getItem(STORAGE_KEY),oldStickerLibrary=window.__duoStickerState?.exportSnapshot?.()||null,oldCircle=(kind==='all'||kind==='param')?getCircleState():null;
    const oldFonts=(kind!=='chat'&&window.ChuanXunFontManager)?await window.ChuanXunFontManager.exportData():null;
    const oldMailbox=(kind!=='chat'&&window.__duoMailbox)?window.__duoMailbox.exportData():null;
    const oldCards=(kind!=='chat'&&window.__duoCardSystem)?window.__duoCardSystem.exportData():null;
    for(const item of mediaEntries)newMedia.set(item.id,await getMediaRecord(item.id));
    let circleWritten=false,fontsWritten=false,mailboxWritten=false,cardsWritten=false;
    try{
      cancelPendingReplies?.();
      clearIncomingRingTimer?.();clearIncomingSchedule?.(true);
      if(typeof callTimerHandle!=='undefined'&&callTimerHandle){clearInterval(callTimerHandle);callTimerHandle=null;}
      window.__duoCircleApi?.pauseTasks?.();window.__duoMailbox?.pauseTasks?.();
      mediaLoadGeneration++;window.__duoStickerLibrary?.invalidate?.();
      mediaUrlCache.forEach(url=>{if(url&&url.startsWith('blob:'))URL.revokeObjectURL(url);});mediaUrlCache.clear();mediaLoadFailed.clear();
      stickerObjectUrls.forEach(url=>{if(url&&url.startsWith('blob:'))URL.revokeObjectURL(url);});stickerObjectUrls.clear();
      const mediaData=new Map();for(const item of mediaEntries){const recBlob=map.get(item.path).blob;if(recBlob.size!==item.size)throw new Error('媒体大小异常：'+item.path);mediaData.set(item.id,{blob:recBlob,meta:item});}
      let incomingState;
      if(kind==='all')incomingState=data.state||data;
      const chatSource=kind==='chat'?data:(kind==='all'?incomingState:null);
      if(chatSource){const ids=new Set();(chatSource.chatHistory||[]).forEach(m=>{if(m.mediaId)ids.add(m.mediaId);});(chatSource.stickers||[]).forEach(x=>{if(x.mediaId)ids.add(x.mediaId);});for(const id of ids){if(!mediaData.has(id))throw new Error('备份包未包含聊天 / 表情引用的媒体：'+id);}}
      if(kind!=='chat'&&map.has('mailbox-data.json')){const mailbox=await readJsonMember(map,'mailbox-data.json'),source=mailbox.mailbox||mailbox,ids=new Set();for(const letter of source.items||[])for(const image of letter.images||[])if(image&&image.id)ids.add(image.id);for(const draft of mailbox.drafts||[])for(const image of draft.images||[])if(image&&image.id)ids.add(image.id);for(const id of ids)if(!mediaData.has(id))throw new Error('备份包未包含信件 / 草稿引用的图片：'+id);}
      for(const [id,v] of mediaData){await putMediaBlob(v.blob,v.meta.kind||'image',v.meta.name||'',id);const check=await getMediaRecord(id);if(!check?.blob||check.blob.size!==v.blob.size)throw new Error('媒体写入后回读校验失败：'+id);}
      if(kind==='all'){
        if(!map.has('circle-state.json'))throw new Error('总备份缺少独立的 Circle 状态文件');
        if(!incomingState||typeof incomingState!=='object'||Array.isArray(incomingState))throw new Error('总备份状态格式无效');
        const circleData=map.has('circle-state.json')?await readJsonMember(map,'circle-state.json'):null;
        if(circleData){const api=window.__duoCircleApi;if(!api||typeof api.validateState!=='function')throw new Error('Circle 不可用，无法校验朋友圈备份');api.validateState(circleData);setCircleState(circleData);circleWritten=true;}
        Object.keys(state).forEach(k=>delete state[k]);Object.assign(state,incomingState);window.__duoStickerState?.applyImportedState?.(incomingState.stickers,incomingState.stickerFavorites,incomingState.stickerTombstones);state.incomingCallSettings=normalizeIncomingCallSettings(incomingState.incomingCallSettings||null);
      }else if(kind==='chat'){
        state.chatHistory=Array.isArray(data.chatHistory)?data.chatHistory:[];window.__duoStickerState?.applyImportedState?.(data.stickers,data.stickerFavorites,data.stickerTombstones);
        if(data.media)state.media=Object.assign(state.media||{},data.media);
        for(const k of ['bubbleShape','bubbleColors','appearanceColors','appearanceSettings','replyWindow','showReadReceipt','readReceiptStyle','typing','offline','callSettings','chatBeautifyPresetId'])if(data[k]!==undefined)state[k]=data[k];
        if(data.incomingCallSettings)state.incomingCallSettings=normalizeIncomingCallSettings(data.incomingCallSettings);
      }else if(kind==='param'){
        if(data.icons)state.icons=Object.assign(state.icons||{},data.icons);if(data.media)state.media=Object.assign(state.media||{},data.media);
        for(const k of ['avatarShape','bubbleShape','customCSS','appearanceSettings','showReadReceipt','readReceiptStyle','chatBeautifyPresetId'])if(data[k]!==undefined)state[k]=data[k];
        for(const k of ['bubbleColors','appearanceColors','replyWindow','typing','offline','callSettings'])if(data[k])state[k]=Object.assign(state[k]||{},data[k]);
        if(data.incomingCallSettings)state.incomingCallSettings=normalizeIncomingCallSettings(data.incomingCallSettings);
        if(Array.isArray(data.cardPhrases))state.cardPhrases=data.cardPhrases;
        state.cardUsageOutbox=Array.isArray(data.cardUsageOutbox)?data.cardUsageOutbox:[];
        if(Array.isArray(data.stickerFavorites))window.__duoStickerState?.replaceFavorites?.(data.stickerFavorites);
      }
      if(kind==='param'&&map.has('circle-settings.json')){
        const api=window.__duoCircleApi;if(!api||typeof api.validateState!=='function')throw new Error('Circle 不可用，无法恢复朋友圈参数');
        const current=getCircleState()||{},settings=await readJsonMember(map,'circle-settings.json');
        const merged={...current,...settings};api.validateState(merged);setCircleState(merged);circleWritten=true;
      }
      if(kind!=='chat'){mailboxWritten=true;window.__duoMailbox.importData(await readJsonMember(map,'mailbox-data.json'));}
      if(kind!=='chat'){cardsWritten=true;window.__duoCardSystem.importData(await readJsonMember(map,'card-system.json'));}
      if(kind!=='chat'){
        const fm=await readJsonMember(map,'font-library.json');
        const restored=[];for(const f of fm.fonts||[]){const x=map.get(f.path);if(!x)throw new Error('字体资源缺失：'+f.id);restored.push({...f,blob:x.blob});}
        fontsWritten=true;await window.ChuanXunFontManager.importData({currentFontId:fm.currentFontId,fonts:restored},{replace:true});
      }
      if(kind==='all'&&incomingState.call&&incomingState.call.phase==='ringing'){incomingState.call={...incomingState.call,active:false,direction:'',phase:'idle',type:'',startAt:0,incomingAt:0,mini:false};}
      if(state.offline){delete state.offline.spaceEnabled;delete state.offline.spaceMin;delete state.offline.spaceMax;delete state.offline.lastSpaceAt;}
      if(state.icons)delete state.icons['home-calendar'];if(state.media)delete state.media['bg-space'];
      ensureChatState();
      const serialized=JSON.stringify(state);localStorage.setItem(STORAGE_KEY,serialized);
      const persisted=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(!persisted||JSON.stringify(persisted)!==serialized)throw new Error('主状态写入后回读校验失败');
      init();renderStickerList();loadMessageMedia();
      showToast('V4 备份恢复完成（资源完整性已校验）');
      return true;
    }catch(e){
      const rollbackErrors=[];
      try{
        Object.keys(state).forEach(k=>delete state[k]);Object.assign(state,JSON.parse(oldState));
        if(oldStorage===null)localStorage.removeItem(STORAGE_KEY);else localStorage.setItem(STORAGE_KEY,oldStorage);
        const stored=localStorage.getItem(STORAGE_KEY);if(stored!==oldStorage)throw new Error('主状态回滚回读不一致');
      }catch(err){rollbackErrors.push('主状态：'+(err.message||err));}
      if(oldStickerLibrary){try{window.__duoStickerState?.restoreSnapshot?.(oldStickerLibrary);}catch(err){rollbackErrors.push('表情包库：'+(err.message||err));}}
      if(circleWritten){try{setCircleState(oldCircle);if(JSON.stringify(getCircleState())!==JSON.stringify(oldCircle))throw new Error('朋友圈回读不一致');}catch(err){rollbackErrors.push('朋友圈：'+(err.message||err));}}
      for(const [id,record] of newMedia){try{
        if(record){const db=await openMediaDB();await new Promise((resolve,reject)=>{const tx=db.transaction(MEDIA_STORE_NAME,'readwrite');tx.objectStore(MEDIA_STORE_NAME).put(record);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});const check=await getMediaRecord(id);if(!check?.blob||check.blob.size!==record.blob.size)throw new Error('媒体回滚回读不一致：'+id);}
        else{await deleteMediaRecord(id);if(await getMediaRecord(id))throw new Error('媒体删除回滚校验失败：'+id);}
      }catch(err){rollbackErrors.push('媒体 '+id+'：'+(err.message||err));}}
      if(fontsWritten&&oldFonts){try{await window.ChuanXunFontManager.importData(oldFonts,{replace:true});const check=await window.ChuanXunFontManager.exportData();if(check.currentFontId!==(oldFonts.currentFontId||null)||check.fonts.length!==oldFonts.fonts.length||check.fonts.some(x=>!oldFonts.fonts.some(y=>y.id===x.id&&y.size===x.size)))throw new Error('字体库回滚回读不一致');}catch(err){rollbackErrors.push('字体库：'+(err.message||err));}}
      if(mailboxWritten&&oldMailbox){try{window.__duoMailbox.importData(oldMailbox);if(JSON.stringify(window.__duoMailbox.exportData())!==JSON.stringify(oldMailbox))throw new Error('信件数据回滚回读不一致');}catch(err){rollbackErrors.push('信件：'+(err.message||err));}}
      if(cardsWritten&&oldCards){try{window.__duoCardSystem.importData(oldCards);if(JSON.stringify(window.__duoCardSystem.exportData())!==JSON.stringify(oldCards))throw new Error('字卡数据回滚回读不一致');}catch(err){rollbackErrors.push('字卡：'+(err.message||err));}}
      mediaLoadGeneration++;window.__duoStickerLibrary?.invalidate?.();mediaUrlCache.forEach(url=>{if(url&&url.startsWith('blob:'))URL.revokeObjectURL(url);});mediaUrlCache.clear();mediaLoadFailed.clear();stickerObjectUrls.forEach(url=>{if(url&&url.startsWith('blob:'))URL.revokeObjectURL(url);});stickerObjectUrls.clear();
      try{init();renderStickerList();loadMessageMedia();}catch(err){rollbackErrors.push('界面重建：'+(err.message||err));}
      if(rollbackErrors.length)throw new Error((e.message||'恢复失败')+'；回滚未完全通过：'+rollbackErrors.join('；'));
      throw e;
    }
  }
  let restoreInProgress=false;
  async function restoreV4(blob){
    if(restoreInProgress||window.__duoRestoreInProgress||window.__duoExportInProgress)throw new Error('已有备份导出或恢复任务正在执行，请等待完成');
    restoreInProgress=true;window.__duoRestoreInProgress=true;let overlay=null;
    try{
      overlay=document.createElement('div');overlay.id='duoRestoreOverlay';overlay.textContent='正在校验并恢复备份，请勿关闭页面…';overlay.style.cssText='position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(20,20,20,.72);color:#fff;font:600 15px/1.6 sans-serif;text-align:center;';document.body.appendChild(overlay);
      window.__duoCircleApi?.pauseTasks?.();window.__duoMailbox?.pauseTasks?.();
      return await restoreV4Internal(blob);
    }finally{overlay?.remove();restoreInProgress=false;window.__duoRestoreInProgress=false;window.__duoCircleApi?.resumeTasks?.();window.__duoMailbox?.resumeTasks?.();}
  }
  async function exportV4(kind){try{const blob=await buildV4(kind);triggerDownloadBlob('双人空间_'+kind+'_backup_v4.zip',blob);showToast(kind==='all'?'V4 总备份已导出':'V4 备份已导出');}catch(e){showToast('V4 备份失败：'+(e.message||e));throw e;}}
  document.addEventListener('click',function(e){const b=e.target&&e.target.closest?e.target.closest('#backupAllBtn,#backupChatBtn,#backupParamBtn'):null;if(!b)return;e.preventDefault();e.stopImmediatePropagation();exportV4(b.id==='backupAllBtn'?'all':b.id==='backupChatBtn'?'chat':'param').catch(()=>{});},true);
  document.addEventListener('change',function(e){if(!e.target||e.target.id!=='backupImporter')return;const file=e.target.files&&e.target.files[0];if(!file)return;e.stopImmediatePropagation();if(file.size>MAX_ARCHIVE){showToast('备份文件超过 1 GB 上限');e.target.value='';return;}if(/\.zip$/i.test(file.name)||file.type==='application/zip'){restoreV4(file).catch(err=>showToast('V4 备份导入失败：'+(err.message||err))).finally(()=>{e.target.value='';});}else{if(file.size>MAX_JSON_MEMBER){showToast('旧版 JSON 备份超过 128 MB 单文件读取上限');e.target.value='';return;}file.text().then(t=>applyBackupPayload(JSON.parse(t))).catch(err=>showToast('旧版 JSON 备份导入失败：'+(err.message||err))).finally(()=>{e.target.value='';});}},true);
  const importer=document.getElementById('backupImporter');if(importer)importer.accept='.json,.zip,application/json,application/zip';
  window.__duoBackupV4={build:buildV4,restore:restoreV4,unzip:unzipStored,inspect:inspectBlob,version:4};
})();