/* 双人空间 V4 ZIP 备份：无压缩 ZIP + 分块 SHA-256 / CRC32 + v3 JSON 兼容。 */
(function(){
  'use strict';
  if(window.__duoBackupV4Installed)return;
  window.__duoBackupV4Installed=true;
  const MAX_ARCHIVE=1024*1024*1024, CHUNK=1024*1024;
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
  async function makeZip(entries){if(entries.length>65534)throw new Error('备份条目数量超过 ZIP 限制');let total=0,offset=0;const parts=[],central=[],resources=[];for(const e of entries){if(!(e.blob instanceof Blob)||!e.path||e.path.startsWith('/')||e.path.split('/').includes('..'))throw new Error('备份资源路径或内容无效');if(e.blob.size>0xffffffff)throw new Error('单项资源超过 ZIP32 限制');total+=e.blob.size;if(total>MAX_ARCHIVE)throw new Error('备份资源合计超过 1 GB 限制');const h=await inspectBlob(e.blob),name=e.path;const meta={path:name,size:e.blob.size,crc32:h.crc32,sha256:h.sha256,type:e.type||'file',mimeType:e.mimeType||e.blob.type||'application/octet-stream'};for(const k of ['id','name','kind','format','createdAt'])if(e[k]!==undefined)meta[k]=e[k];resources.push(meta);const [lh,ln]=localHeader(name,e.blob.size,parseInt(h.crc32,16)>>>0);parts.push(lh,ln,e.blob);const [ch,cn]=centralHeader(name,e.blob.size,parseInt(h.crc32,16)>>>0,offset);central.push(ch,cn);offset+=lh.length+ln.length+e.blob.size;if(offset>0xffffffff)throw new Error('备份总长度超过 ZIP32 4 GB 偏移范围');}const manifest={format:'twodeers-backup',formatVersion:4,kind:window.__duoBackupKind||'all',createdAt:new Date().toISOString(),resourceCount:resources.length,totalResourceBytes:total,hashAlgorithm:'SHA-256',checksumAlgorithm:'CRC-32',compression:'store',fontsCurrentId:window.__duoBackupFontCurrentId||null,resources};const mb=new Blob([JSON.stringify(manifest,null,2)],{type:'application/json'});const mh=await inspectBlob(mb);const [lh,ln]=localHeader('manifest.json',mb.size,parseInt(mh.crc32,16)>>>0);parts.push(lh,ln,mb);const mo=offset;offset+=lh.length+ln.length+mb.size;const [ch,cn]=centralHeader('manifest.json',mb.size,parseInt(mh.crc32,16)>>>0,mo);central.push(ch,cn);const centralSize=central.reduce((n,x)=>n+x.length,0);const eocd=new Uint8Array(22),d=new DataView(eocd.buffer);d.setUint32(0,0x06054b50,true);d.setUint16(8,entries.length+1,true);d.setUint16(10,entries.length+1,true);d.setUint32(12,centralSize,true);d.setUint32(16,offset,true);d.setUint16(20,0,true);parts.push(...central,eocd);return new Blob(parts,{type:'application/zip'});}
  function jsonBlob(value){return new Blob([JSON.stringify(value)],{type:'application/json;charset=utf-8'});}
  const snapshotCoordinator=window.BackupSnapshotCoordinator;
  if(!snapshotCoordinator)throw new Error('备份快照协调器尚未加载');
  snapshotCoordinator.register('chat',{snapshot:function(){return JSON.parse(JSON.stringify(state));}});
  snapshotCoordinator.register('circle',{snapshot:function(){return JSON.parse(JSON.stringify(getCircleState()||{}));}});
  snapshotCoordinator.register('media',{snapshot:function(){return typeof getCurrentMediaIds==='function'?getCurrentMediaIds().slice():[];}});
  snapshotCoordinator.register('fonts',{snapshot:function(){return window.ChuanXunFontManager?window.ChuanXunFontManager.exportData():Promise.resolve({currentFontId:null,fonts:[]});}});
  function mediaIdsFromState(source){
    const ids=new Set();
    (source.chatHistory||[]).forEach(function(item){if(item&&item.mediaId)ids.add(item.mediaId);});
    (source.stickers||[]).forEach(function(item){if(item&&item.mediaId)ids.add(item.mediaId);});
    return Array.from(ids);
  }
  async function buildV4(kind){
    if(!['all','chat','param'].includes(kind))throw new Error('不支持的备份类型');
    const required=kind==='all'?['chat','circle','media','fonts']:(kind==='chat'?['chat','media']:['chat','fonts']);
    const snapshot=await snapshotCoordinator.beginSnapshot(required);
    let entries=[],fontsCurrentId=null;
    try{
      const source=snapshot.get('chat');
      let stateData={},mediaIds=[];
      if(kind==='all'){stateData={state:source};mediaIds=snapshot.get('media');}
      else if(kind==='chat'){
        mediaIds=mediaIdsFromState(source);
        stateData={chatHistory:source.chatHistory,stickers:source.stickers,stickerFavorites:source.stickerFavorites||[],media:{'avatar-me':source.media?.['avatar-me'],'avatar-other':source.media?.['avatar-other'],'bg-chat':source.media?.['bg-chat']},bubbleShape:source.bubbleShape,bubbleColors:source.bubbleColors,appearanceColors:source.appearanceColors,appearanceSettings:source.appearanceSettings,replyWindow:source.replyWindow,showReadReceipt:source.showReadReceipt,typing:source.typing,offline:source.offline,callSettings:source.callSettings,incomingCallSettings:source.incomingCallSettings};
      }else{
        stateData={icons:source.icons,media:source.media,avatarShape:source.avatarShape,bubbleShape:source.bubbleShape,bubbleColors:source.bubbleColors,appearanceColors:source.appearanceColors,appearanceSettings:source.appearanceSettings,customCSS:source.customCSS,replyWindow:source.replyWindow,showReadReceipt:source.showReadReceipt,typing:source.typing,offline:source.offline,cardPhrases:source.cardPhrases,callSettings:source.callSettings,incomingCallSettings:source.incomingCallSettings,stickerFavorites:source.stickerFavorites||[]};
      }
      entries.push({path:'state.json',blob:jsonBlob(stateData),type:'state'});
      if(kind==='all')entries.push({path:'circle-state.json',blob:jsonBlob(snapshot.get('circle')),type:'circle-state'});
      const mediaRecords=await Promise.all(mediaIds.map(async function(id){
        const record=await getMediaRecord(id);
        if(!record||!record.blob)throw new Error('备份媒体缺失：'+id);
        return record;
      }));
      for(const record of mediaRecords)entries.push({path:'media/'+encodeURIComponent(record.id)+'.blob',blob:record.blob,type:'media',id:record.id,kind:record.kind,name:record.name,mimeType:record.mimeType,createdAt:record.createdAt});
      if(kind!=='chat'){
        const exported=snapshot.get('fonts');
        fontsCurrentId=exported.currentFontId||null;
        const fontMeta=[];
        for(const font of exported.fonts||[]){
          if(!font.blob)throw new Error('字体文件缺失：'+font.id);
          const path='fonts/'+encodeURIComponent(font.id)+'.'+font.format;
          entries.push({path:path,blob:font.blob,type:'font',id:font.id,name:font.name,format:font.format,mimeType:font.mimeType,createdAt:font.createdAt});
          fontMeta.push({id:font.id,name:font.name,fileName:font.fileName,format:font.format,mimeType:font.mimeType,size:font.size,createdAt:font.createdAt,path:path});
        }
        entries.push({path:'font-library.json',blob:jsonBlob({currentFontId:fontsCurrentId,fonts:fontMeta}),type:'font-library'});
      }
      snapshot.assertUnchanged();
    }finally{
      // All mutable module data and immutable Blob references are now captured.
      // Release the business event barrier before CPU-heavy hashing and ZIP assembly.
      snapshot.release();
    }
    window.__duoBackupKind=kind;window.__duoBackupFontCurrentId=fontsCurrentId;
    try{return await makeZip(entries);}
    finally{delete window.__duoBackupKind;delete window.__duoBackupFontCurrentId;}
  }
  function safePath(path){return typeof path==='string'&&path.length>0&&path.length<1024&&!path.startsWith('/')&&!path.includes('\\')&&!path.split('/').some(x=>x==='..'||x==='.'||x==='');}
  async function unzipStored(blob){
    if(!(blob instanceof Blob)||blob.size<22||blob.size>MAX_ARCHIVE)throw new Error('ZIP 文件为空、过小或超过 1 GB');
    const tailStart=Math.max(0,blob.size-65557),tail=new DataView(await blob.slice(tailStart).arrayBuffer());let eocd=-1;for(let p=tail.byteLength-22;p>=0;p--){if(tail.getUint32(p,true)===0x06054b50){eocd=p;break;}}if(eocd<0)throw new Error('ZIP 目录结束标记缺失');
    const count=tail.getUint16(eocd+10,true),centralSize=tail.getUint32(eocd+12,true),centralOffset=tail.getUint32(eocd+16,true);if(count<1||count>65535||centralSize>64*1024*1024||centralOffset+centralSize>blob.size)throw new Error('ZIP 目录参数超出允许范围');
    const cbuf=await blob.slice(centralOffset,centralOffset+centralSize).arrayBuffer(),dv=new DataView(cbuf),map=new Map();let p=0;
    for(let i=0;i<count;i++){if(p+46>dv.byteLength||dv.getUint32(p,true)!==0x02014b50)throw new Error('ZIP 中央目录损坏');const flags=dv.getUint16(p+8,true),method=dv.getUint16(p+10,true),crc=dv.getUint32(p+16,true),size=dv.getUint32(p+20,true),usize=dv.getUint32(p+24,true),nl=dv.getUint16(p+28,true),el=dv.getUint16(p+30,true),cl=dv.getUint16(p+32,true),off=dv.getUint32(p+42,true);if((flags&1)||method!==0||size!==usize||size>MAX_ARCHIVE)throw new Error('仅支持未加密、无压缩的安全 ZIP 备份');const name=dec.decode(new Uint8Array(cbuf,p+46,nl));if(!safePath(name)||map.has(name))throw new Error('ZIP 文件路径非法或重复：'+name);const local= new DataView(await blob.slice(off,off+30).arrayBuffer());if(local.byteLength!==30||local.getUint32(0,true)!==0x04034b50)throw new Error('ZIP 本地文件头损坏');const lnl=local.getUint16(26,true),lel=local.getUint16(28,true),dataStart=off+30+lnl+lel;if(dataStart+size>blob.size)throw new Error('ZIP 数据长度越界：'+name);map.set(name,{blob:blob.slice(dataStart,dataStart+size),size,crc32:crc.toString(16).padStart(8,'0')});p+=46+nl+el+cl;}
    if(!map.has('manifest.json'))throw new Error('缺少 manifest.json');const manifest=JSON.parse(await map.get('manifest.json').blob.text());if(manifest.format!=='twodeers-backup'||manifest.formatVersion!==4||!['all','chat','param'].includes(manifest.kind)||!Array.isArray(manifest.resources))throw new Error('不是受支持的双人空间 V4 备份');
    if(manifest.resources.length!==map.size-1)throw new Error('manifest 资源数量与 ZIP 内容不一致');
    for(const item of manifest.resources){if(!item||!safePath(item.path)||!map.has(item.path))throw new Error('备份缺少资源：'+(item&&item.path||''));const file=map.get(item.path);if(item.size!==file.size)throw new Error('资源字节数不匹配：'+item.path);const got=await inspectBlob(file.blob);if(got.sha256!==item.sha256||got.crc32!==item.crc32||got.crc32!==file.crc32)throw new Error('资源校验失败：'+item.path);file.meta=item;}
    return {manifest,map};
  }
  async function restoreV4(blob){
    const coordinator=window.BackupSnapshotCoordinator;
    return coordinator&&typeof coordinator.trackOperation==='function'
      ? coordinator.trackOperation(()=>restoreV4Internal(blob))
      : restoreV4Internal(blob);
  }
  async function restoreV4Internal(blob){
    const parsed=await unzipStored(blob),{manifest,map}=parsed,kind=manifest.kind;
    const data=JSON.parse(await map.get('state.json').blob.text());if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('state.json 格式无效');
    const mediaEntries=manifest.resources.filter(x=>x.type==='media'),fontEntries=manifest.resources.filter(x=>x.type==='font');
    const newMedia=new Map(),oldState=JSON.stringify(state),oldStorage=localStorage.getItem(STORAGE_KEY),oldCircle=kind==='all'?getCircleState():null;
    const oldFonts=(kind!=='chat'&&window.ChuanXunFontManager)?await window.ChuanXunFontManager.exportData():null;
    for(const item of mediaEntries)newMedia.set(item.id,await getMediaRecord(item.id));
    let circleWritten=false,fontsWritten=false;
    try{
      const mediaData=new Map();for(const item of mediaEntries){const recBlob=map.get(item.path).blob;if(recBlob.size!==item.size)throw new Error('媒体大小异常：'+item.path);mediaData.set(item.id,{blob:recBlob,meta:item});}
      let incomingState;
      if(kind==='all')incomingState=data.state||data;
      const chatSource=kind==='chat'?data:(kind==='all'?incomingState:null);
      if(chatSource){const ids=new Set();(chatSource.chatHistory||[]).forEach(m=>{if(m.mediaId)ids.add(m.mediaId);});(chatSource.stickers||[]).forEach(x=>{if(x.mediaId)ids.add(x.mediaId);});for(const id of ids){if(!mediaData.has(id))throw new Error('备份包未包含聊天 / 表情引用的媒体：'+id);}}
      for(const [id,v] of mediaData){await putMediaBlob(v.blob,v.meta.kind||'image',v.meta.name||'',id);const check=await getMediaRecord(id);if(!check?.blob||check.blob.size!==v.blob.size)throw new Error('媒体写入后回读校验失败：'+id);}
      if(kind==='all'){
        if(!map.has('circle-state.json'))throw new Error('总备份缺少独立的 Circle 状态文件');
        if(!incomingState||typeof incomingState!=='object'||Array.isArray(incomingState))throw new Error('总备份状态格式无效');
        const circleData=map.has('circle-state.json')?JSON.parse(await map.get('circle-state.json').blob.text()):null;
        if(circleData){const api=window.__duoCircleApi;if(!api||typeof api.validateState!=='function')throw new Error('Circle 不可用，无法校验朋友圈备份');api.validateState(circleData);setCircleState(circleData);circleWritten=true;}
        Object.keys(state).forEach(k=>delete state[k]);Object.assign(state,incomingState);state.incomingCallSettings=normalizeIncomingCallSettings(incomingState.incomingCallSettings||null);state.stickerFavorites=Array.isArray(incomingState.stickerFavorites)?incomingState.stickerFavorites:[];
      }else if(kind==='chat'){
        state.chatHistory=Array.isArray(data.chatHistory)?data.chatHistory:[];state.stickers=Array.isArray(data.stickers)?data.stickers:[];state.stickerFavorites=Array.isArray(data.stickerFavorites)?data.stickerFavorites:[];
        if(data.media)state.media=Object.assign(state.media||{},data.media);
        for(const k of ['bubbleShape','bubbleColors','appearanceColors','appearanceSettings','replyWindow','showReadReceipt','typing','offline','callSettings'])if(data[k]!==undefined)state[k]=data[k];
        if(data.incomingCallSettings)state.incomingCallSettings=normalizeIncomingCallSettings(data.incomingCallSettings);
      }else if(kind==='param'){
        if(data.icons)state.icons=Object.assign(state.icons||{},data.icons);if(data.media)state.media=Object.assign(state.media||{},data.media);
        for(const k of ['avatarShape','bubbleShape','customCSS','appearanceSettings','showReadReceipt'])if(data[k]!==undefined)state[k]=data[k];
        for(const k of ['bubbleColors','appearanceColors','replyWindow','typing','offline','callSettings'])if(data[k])state[k]=Object.assign(state[k]||{},data[k]);
        if(data.incomingCallSettings)state.incomingCallSettings=normalizeIncomingCallSettings(data.incomingCallSettings);
        if(Array.isArray(data.cardPhrases))state.cardPhrases=data.cardPhrases;
        if(Array.isArray(data.stickerFavorites))state.stickerFavorites=data.stickerFavorites;
      }
      if(kind!=='chat'&&window.ChuanXunFontManager&&!map.has('font-library.json'))throw new Error('参数/总备份缺少字体库清单');
      if(kind!=='chat'&&window.ChuanXunFontManager&&map.has('font-library.json')){
        const fm=JSON.parse(await map.get('font-library.json').blob.text());
        const restored=[];for(const f of fm.fonts||[]){const x=map.get(f.path);if(!x)throw new Error('字体资源缺失：'+f.id);restored.push({...f,blob:x.blob});}
        fontsWritten=true;await window.ChuanXunFontManager.importData({currentFontId:fm.currentFontId,fonts:restored},{replace:true});
      }
      if(kind==='all'&&incomingState.call&&incomingState.call.phase==='ringing'){incomingState.call.active=false;}
      if(state.offline){delete state.offline.spaceEnabled;delete state.offline.spaceMin;delete state.offline.spaceMax;delete state.offline.lastSpaceAt;}
      if(state.icons)delete state.icons['home-calendar'];if(state.media)delete state.media['bg-space'];
      ensureChatState();
      if(save()===false)throw new Error('聊天数据写入失败，已取消 V4 恢复');
      init();renderStickerList();loadMessageMedia();
      showToast('V4 备份恢复完成（资源完整性已校验）');
      return true;
    }catch(e){
      try{
        Object.keys(state).forEach(k=>delete state[k]);
        Object.assign(state,JSON.parse(oldState));
        restoreChatStorage(oldStorage);
      }catch(rollbackChatError){console.warn('V4 chat rollback failed',rollbackChatError);}
      if(circleWritten){try{setCircleState(oldCircle);}catch(rollbackCircleError){console.warn('V4 Circle rollback failed',rollbackCircleError);}}
      for(const [id,record] of newMedia){
        try{await restoreMediaRecord(id,record);}
        catch(rollbackMediaError){console.warn('V4 media rollback failed',rollbackMediaError);}
      }
      if(fontsWritten&&oldFonts){try{await window.ChuanXunFontManager.importData(oldFonts,{replace:true});}catch(rollbackFontError){console.warn('V4 font rollback failed',rollbackFontError);}}
      try{init();}catch(rollbackUiError){console.warn('V4 UI rollback failed',rollbackUiError);}
      throw e;
    }
  }
  async function exportV4(kind){try{const blob=await buildV4(kind);if(!window.BackupFileService)throw new Error('统一文件保存服务尚未加载');const saved=await window.BackupFileService.save('双人空间_'+kind+'_backup_v4.zip',blob);showToast(saved.status==='saved'?(saved.verified?'V4 备份已保存并校验':'V4 备份已保存（目标文件未能回读）'):'V4 备份文件已交给保存入口');}catch(e){showToast('V4 备份失败：'+(e.message||e));throw e;}}
  document.addEventListener('click',function(e){const b=e.target&&e.target.closest?e.target.closest('#backupAllBtn,#backupChatBtn,#backupParamBtn'):null;if(!b)return;e.preventDefault();e.stopImmediatePropagation();exportV4(b.id==='backupAllBtn'?'all':b.id==='backupChatBtn'?'chat':'param').catch(()=>{});},true);
  document.addEventListener('change',function(e){if(!e.target||e.target.id!=='backupImporter')return;const file=e.target.files&&e.target.files[0];if(!file)return;e.stopImmediatePropagation();if(/\.zip$/i.test(file.name)||file.type==='application/zip'){restoreV4(file).catch(err=>showToast('V4 备份导入失败：'+(err.message||err))).finally(()=>{e.target.value='';});}else{file.text().then(t=>applyBackupPayload(JSON.parse(t))).catch(err=>showToast('旧版 JSON 备份导入失败：'+(err.message||err))).finally(()=>{e.target.value='';});}},true);
  const importer=document.getElementById('backupImporter');if(importer)importer.accept='.json,.zip,application/json,application/zip';
  window.__duoBackupV4={build:buildV4,restore:restoreV4,unzip:unzipStored,inspect:inspectBlob,version:4};
})();