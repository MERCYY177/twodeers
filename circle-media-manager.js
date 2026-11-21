(function(){
  'use strict';

  const PREFIX = 'idb-media:';
  const PROFILE_FIELDS = ['myAvatar','otherAvatar','myCover','otherCover'];
  const MAX_MEDIA_BYTES = 512 * 1024 * 1024;
  const MAX_BUNDLE_BYTES = 512 * 1024 * 1024;
  const MAX_PORTABLE_EXPORT_BYTES = 360 * 1024 * 1024;
  const MAX_LEGACY_ITEMS = 10000;
  const objectUrls = new Map();
  const loading = new Map();
  const missing = new Set();
  let generation = 0;
  let migrationPromise = null;

  function makeRef(id){
    const value=String(id||'').trim();
    if(!/^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,255}$/.test(value))throw new Error('朋友圈媒体 ID 无效');
    return PREFIX+value;
  }
  function parseRef(value){
    if(typeof value!=='string'||!value.startsWith(PREFIX))return '';
    const id=value.slice(PREFIX.length);
    return /^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,255}$/.test(id)?id:'';
  }
  function isDataMediaUrl(value){
    return typeof value==='string'&&/^data:(?:image\/(?:png|jpe?g|webp|gif|apng|avif|svg\+xml)|video\/[a-z0-9.+-]+);base64,[a-z0-9+/=]+$/i.test(value);
  }
  function collectIdsFromState(circle, options={}){
    const ids=new Set();
    if(!circle||typeof circle!=='object')return ids;
    for(const field of PROFILE_FIELDS){
      const id=parseRef(circle[field]);if(id)ids.add(id);
    }
    if(!options.profileOnly){
      for(const post of Array.isArray(circle.posts)?circle.posts:[]){
        for(const media of Array.isArray(post?.media)?post.media:[]){
          const id=parseRef(media?.src);if(id)ids.add(id);
        }
      }
    }
    return ids;
  }
  function preserveCircleRecords(records,ids){
    const wanted=ids instanceof Set?ids:new Set(ids||[]);
    const source=Array.isArray(records)?records:[];
    const preserved=source.filter(record=>record&&wanted.has(record.id));
    if(preserved.length!==wanted.size)throw new Error('朋友圈媒体记录不完整，已停止重置以避免丢失存档');
    return preserved;
  }
  function verifyPreservedCircleRecords(records,ids){
    const wanted=ids instanceof Set?ids:new Set(ids||[]);
    const source=Array.isArray(records)?records:[];
    if(source.length!==wanted.size)return false;
    const byId=new Map(source.map(record=>[record?.id,record]));
    for(const id of wanted){const record=byId.get(id);if(!record?.blob||!record.blob.size)return false;}
    return true;
  }
  function hasBytesAt(bytes, offset, text){
    for(let i=0;i<text.length;i++)if(bytes[offset+i]!==text.charCodeAt(i))return false;
    return true;
  }
  function readUint32BE(bytes, offset){
    return (((bytes[offset]<<24)|(bytes[offset+1]<<16)|(bytes[offset+2]<<8)|bytes[offset+3])>>>0);
  }
  function readUint32LE(bytes, offset){
    return (((bytes[offset+3]<<24)|(bytes[offset+2]<<16)|(bytes[offset+1]<<8)|bytes[offset])>>>0);
  }
  function pngHasAnimationControl(bytes){
    if(bytes.length<20||!hasBytesAt(bytes,0,'\x89PNG\r\n\x1a\n'))return false;
    let offset=8;
    while(offset+12<=bytes.length){
      const length=readUint32BE(bytes,offset);
      if(length>bytes.length-offset-12)return false;
      if(hasBytesAt(bytes,offset+4,'acTL'))return length===8;
      if(hasBytesAt(bytes,offset+4,'IDAT'))return false;
      offset+=12+length;
    }
    return false;
  }
  function webpHasAnimationChunks(bytes){
    if(bytes.length<20||!hasBytesAt(bytes,0,'RIFF')||!hasBytesAt(bytes,8,'WEBP'))return false;
    const riffEnd=Math.min(bytes.length,readUint32LE(bytes,4)+8);
    let offset=12;
    while(offset+8<=riffEnd){
      const length=readUint32LE(bytes,offset+4);
      if(length>riffEnd-offset-8)return false;
      if(hasBytesAt(bytes,offset,'ANIM')||hasBytesAt(bytes,offset,'ANMF'))return true;
      if(hasBytesAt(bytes,offset,'VP8X')&&length>=10&&(bytes[offset+8]&0x02)!==0)return true;
      offset+=8+length+(length&1);
    }
    return false;
  }
  function looksLikeSvg(bytes){
    try{
      const source=(typeof TextDecoder==='function'?new TextDecoder('utf-8',{fatal:false}).decode(bytes):Array.from(bytes,b=>String.fromCharCode(b)).join('')).replace(/^\uFEFF/,'');
      let index=0;
      while(index<source.length){
        while(/\s/.test(source[index]||''))index++;
        if(source.startsWith('<?',index)){
          const end=source.indexOf('?>',index+2);if(end<0)return false;index=end+2;continue;
        }
        if(source.startsWith('<!--',index)){
          const end=source.indexOf('-->',index+4);if(end<0)return false;index=end+3;continue;
        }
        if(/^<!doctype\b/i.test(source.slice(index,index+10))){
          let quote='',brackets=0,end=index+9;
          for(;end<source.length;end++){
            const ch=source[end];
            if(quote){if(ch===quote)quote='';continue;}
            if(ch==='"'||ch==="'"){quote=ch;continue;}
            if(ch==='['){brackets++;continue;}
            if(ch===']'&&brackets){brackets--;continue;}
            if(ch==='>'&&brackets===0)break;
          }
          if(end>=source.length)return false;index=end+1;continue;
        }
        const match=source.slice(index).match(/^<([A-Za-z_][A-Za-z0-9_.:-]*)\b/);
        if(!match)return false;
        const parts=match[1].toLowerCase().split(':');
        return parts[parts.length-1]==='svg';
      }
      return false;
    }catch(_){return false;}
  }
  async function getOriginalImageKind(blob, filename=''){
    if(!blob||typeof blob.slice!=='function')return '';
    const bytes=new Uint8Array(await blob.slice(0,Math.min(Number(blob.size)||0,256*1024)).arrayBuffer());
    if(bytes.length>=6&&(hasBytesAt(bytes,0,'GIF87a')||hasBytesAt(bytes,0,'GIF89a')))return 'gif';
    if(bytes.length>=8&&hasBytesAt(bytes,0,'\x89PNG\r\n\x1a\n'))return pngHasAnimationControl(bytes)?'apng':'';
    if(bytes.length>=12&&hasBytesAt(bytes,0,'RIFF')&&hasBytesAt(bytes,8,'WEBP'))return webpHasAnimationChunks(bytes)?'webp-animated':'webp';
    if(looksLikeSvg(bytes))return 'svg';
    return '';
  }
  async function isAnimatedImageBlob(blob){
    const kind=await getOriginalImageKind(blob);
    return kind==='gif'||kind==='apng'||kind==='webp-animated';
  }
  async function requiresOriginalImageBytes(blob, filename=''){
    const kind=await getOriginalImageKind(blob,filename);
    return kind==='svg'||kind==='gif'||kind==='apng'||kind==='webp'||kind==='webp-animated';
  }
  function getIds(options={}){
    let circle;
    try{circle=typeof getCircleState==='function'?getCircleState():null;}catch(error){throw new Error('无法读取朋友圈媒体引用：'+(error?.message||error));}
    return collectIdsFromState(circle,options);
  }
  function release(id){
    const url=objectUrls.get(id);
    if(url){try{URL.revokeObjectURL(url);}catch(_){}objectUrls.delete(id);}
    missing.delete(id);
  }
  function invalidate(){
    generation++;
    for(const id of objectUrls.keys())release(id);
    loading.clear();missing.clear();
  }
  function cacheBlob(id,blob){
    if(!id||!blob)return '';
    const existing=objectUrls.get(id);
    if(existing)return existing;
    const url=URL.createObjectURL(blob);
    objectUrls.set(id,url);missing.delete(id);return url;
  }
  function resolve(value){
    const id=parseRef(value);
    return id?(objectUrls.get(id)||''):'';
  }
  async function storeBlob(blob,kind='image',name=''){
    if(!(blob instanceof Blob)||!blob.size)throw new Error('朋友圈媒体文件为空或格式无效');
    if(blob.size>MAX_MEDIA_BYTES)throw new Error('朋友圈单个媒体超过 512 MB 限制');
    const id=await putMediaBlob(blob,'circle-'+String(kind||'image').replace(/[^a-z0-9-]/gi,''),name||'');
    try{
      const ref=makeRef(id);
      cacheBlob(id,blob);
      return ref;
    }catch(error){
      release(id);
      try{await deleteIfUnreferenced(id);}catch(cleanupError){console.warn('[朋友圈媒体] URL 创建失败后的文件清理失败',id,cleanupError);}
      throw error;
    }
  }
  async function storeDataUrl(dataUrl,kind='image',name=''){
    if(parseRef(dataUrl))return dataUrl;
    if(!isDataMediaUrl(dataUrl))throw new Error('朋友圈媒体地址不是受支持的图片或视频 Data URL');
    let response,blob;
    try{response=await fetch(dataUrl);blob=await response.blob();}catch(error){throw new Error('朋友圈媒体解码失败：'+(error?.message||error));}
    if(!blob?.size||blob.size>MAX_MEDIA_BYTES)throw new Error('朋友圈媒体为空或超过 512 MB 限制');
    return storeBlob(blob,kind,name);
  }
  async function loadOne(id){
    if(objectUrls.has(id))return objectUrls.get(id);
    if(missing.has(id))return '';
    if(loading.has(id))return loading.get(id);
    const token=generation;
    const job=(async()=>{
      try{
        const record=await getMediaRecord(id);
        if(token!==generation)return '';
        if(!record?.blob)throw new Error('朋友圈媒体文件不存在');
        return cacheBlob(id,record.blob);
      }catch(error){if(token===generation)missing.add(id);throw error;}
      finally{if(loading.get(id)===job)loading.delete(id);}
    })();
    loading.set(id,job);return job;
  }
  async function ensureRefs(refs){
    const values=Array.isArray(refs)?refs:(refs==null?[]:[refs]);
    const ids=new Set();
    let invalid=0;
    for(const value of values){
      const id=parseRef(value);
      if(id)ids.add(id);else invalid++;
    }
    // A previous failed read can be transient (for example, IndexedDB was
    // temporarily unavailable). Every explicit ensure call is a retry boundary.
    for(const id of ids)missing.delete(id);
    const token=generation;
    const results=await Promise.allSettled([...ids].map(id=>loadOne(id)));
    if(token!==generation)return {loaded:0,missing:0,stale:true};
    const failed=results.filter(item=>item.status==='rejected').length;
    return {loaded:results.length-failed,missing:failed+invalid};
  }
  async function ensure(circle){
    let snapshot=circle;
    if(!snapshot){try{snapshot=getCircleState();}catch(_){return {loaded:0,missing:0};}}
    const ids=[...collectIdsFromState(snapshot)];
    const result=await ensureRefs(ids.map(makeRef));
    if(result.stale)return result;
    if(typeof window.__duoCircleApi?.refreshMedia==='function'){
      try{window.__duoCircleApi.refreshMedia();}catch(error){console.warn('[朋友圈媒体] 刷新界面失败',error);}
    }
    return result;
  }
  async function performLegacyMigration(options={}){
    if((window.__duoRestoreInProgress&&!options.allowRestore)||(window.__duoExportInProgress&&!options.allowExport))return {migrated:0,skipped:true};
    const api=window.__duoCircleApi;
    if(!api||typeof api.exportState!=='function'||typeof api.importState!=='function')return {migrated:0,unavailable:true};
    const original=api.exportState();
    const next=JSON.parse(JSON.stringify(original));
    const replacements=new Map(),created=[];
    let totalBytes=0,itemCount=0;
    const convert=async(value,kind,name)=>{
      if(parseRef(value)||!isDataMediaUrl(value))return value;
      if(replacements.has(value))return replacements.get(value);
      if(++itemCount>MAX_LEGACY_ITEMS)throw new Error('旧朋友圈媒体数量超过 10000 项迁移上限');
      const response=await fetch(value),blob=await response.blob();
      totalBytes+=blob.size;
      if(!blob.size||totalBytes>MAX_MEDIA_BYTES)throw new Error('旧朋友圈媒体累计迁移量超过 512 MB 安全上限');
      const id=await putMediaBlob(blob,'circle-'+kind,name||'legacy-circle-media');
      created.push(id);cacheBlob(id,blob);
      const ref=makeRef(id);replacements.set(value,ref);return ref;
    };
    let stateCommitted=false;
    try{
      for(const field of PROFILE_FIELDS){
        if(isDataMediaUrl(next[field]))next[field]=await convert(next[field],field.toLowerCase().includes('cover')?'cover':'avatar',field);
      }
      for(let postIndex=0;postIndex<(next.posts||[]).length;postIndex++){
        const post=next.posts[postIndex];
        for(let mediaIndex=0;mediaIndex<(post.media||[]).length;mediaIndex++){
          const media=post.media[mediaIndex];
          if(media&&isDataMediaUrl(media.src))media.src=await convert(media.src,media.type==='video'?'video':'image','circle-post-'+(post.id||postIndex));
        }
      }
      if(created.length){
        const result=api.importState(next);
        if(result===false)throw new Error('旧朋友圈媒体迁移后的状态保存失败');
        stateCommitted=true;
      }
      const result=await ensure(created.length?next:original);
      if(created.some(id=>!resolve(makeRef(id))))throw new Error('迁移后的朋友圈媒体回读校验失败');
      return {migrated:created.length,loaded:result.loaded,missing:result.missing};
    }catch(error){
      if(stateCommitted){try{api.importState(original);}catch(rollbackError){console.error('[朋友圈媒体] 迁移状态回滚失败',rollbackError);}}
      invalidate();
      for(const id of created){try{await deleteIfUnreferenced(id);}catch(cleanupError){console.warn('[朋友圈媒体] 迁移回滚清理失败',id,cleanupError);}}
      try{await ensure(original);}catch(restoreError){console.warn('[朋友圈媒体] 迁移回滚后旧媒体刷新失败',restoreError);}
      throw error;
    }
  }
  function migrateLegacy(options={}){
    if(migrationPromise)return migrationPromise;
    let endMutation=null;
    try{endMutation=window.__duoRuntimeCoordinator?.beginMutation?.('迁移朋友圈旧媒体');}
    catch(error){return Promise.reject(error);}
    const api=window.__duoCircleApi,root=window.__duoCircleRoot,interactionRoot=root?.host||root;
    const wasPaused=window.__duoCircleRestorePaused===true;
    const previousPointerEvents=interactionRoot?.style?.pointerEvents||'';
    const previousBusy=interactionRoot?.getAttribute?.('aria-busy');
    const previousInert=!!interactionRoot?.inert;
    try{api?.pauseTasks?.();if(interactionRoot?.style)interactionRoot.style.pointerEvents='none';if(interactionRoot)interactionRoot.inert=true;interactionRoot?.setAttribute?.('aria-busy','true');}catch(_){}
    const job=performLegacyMigration(options);
    let wrapped;
    wrapped=job.finally(()=>{
      if(migrationPromise===wrapped)migrationPromise=null;
      try{
        if(interactionRoot?.style)interactionRoot.style.pointerEvents=previousPointerEvents;
        if(interactionRoot)interactionRoot.inert=previousInert;
        if(previousBusy===null||previousBusy===undefined)interactionRoot?.removeAttribute?.('aria-busy');else interactionRoot?.setAttribute?.('aria-busy',previousBusy);
        if(!wasPaused)api?.resumeTasks?.();
      }catch(error){console.warn('[朋友圈媒体] 迁移结束后恢复界面状态失败',error);}
      finally{endMutation?.();}
    });
    migrationPromise=wrapped;
    return wrapped;
  }
  function waitForMigration(){return migrationPromise||Promise.resolve();}
  function blobToDataUrl(blob){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error||new Error('媒体转码失败'));reader.readAsDataURL(blob);
    });
  }
  async function exportBundle(){
    const endMutation=window.__duoRuntimeCoordinator?.beginMutation?.('导出朋友圈媒体包');
    try{
      await migrateLegacy();
      const circleState=getCircleState(),mediaFiles=[];let totalBytes=0;
      for(const id of collectIdsFromState(circleState)){
        const record=await getMediaRecord(id);
        if(!record?.blob)throw new Error('朋友圈备份缺少媒体文件：'+id);
        totalBytes+=record.blob.size;
        if(totalBytes>MAX_PORTABLE_EXPORT_BYTES)throw new Error('朋友圈单独 JSON 备份的媒体总量超过 360 MB 限制；更大的媒体库请使用 V4 总备份');
        mediaFiles.push({id,kind:record.kind,name:record.name,mimeType:record.mimeType,size:record.size,createdAt:record.createdAt,dataUrl:await blobToDataUrl(record.blob)});
      }
      return {format:'twodeers-circle-backup',formatVersion:1,exportedAt:new Date().toISOString(),circleState,mediaFiles};
    }finally{endMutation?.();}
  }
  async function importBundle(payload){
    if(!payload||payload.format!=='twodeers-circle-backup'||payload.formatVersion!==1||!payload.circleState||typeof payload.circleState!=='object'||Array.isArray(payload.circleState)||!Array.isArray(payload.mediaFiles))throw new Error('朋友圈备份格式无效');
    const api=window.__duoCircleApi;
    if(!api||typeof api.validateState!=='function')throw new Error('朋友圈尚未就绪');
    api.validateState(payload.circleState);
    if(payload.mediaFiles.length>MAX_LEGACY_ITEMS)throw new Error('朋友圈备份媒体数量过多');
    const endMutation=window.__duoRuntimeCoordinator?.beginMutation?.('导入朋友圈媒体包');
    let oldCircle=null;const snapshots=new Map(),provided=new Set(),written=[];let totalBytes=0;
    try{
      oldCircle=getCircleState();
      for(const item of payload.mediaFiles){
        const kind=String(item?.kind||'circle-image');
        if(!item||typeof item.id!=='string'||!/^([A-Za-z0-9_-])[A-Za-z0-9_.:-]{0,255}$/.test(item.id)||provided.has(item.id)||!/^circle-(?:avatar|cover|image|video)$/.test(kind)||item.name!==undefined&&(typeof item.name!=='string'||item.name.length>512)||!isDataMediaUrl(item.dataUrl))throw new Error('朋友圈备份媒体条目无效');
        provided.add(item.id);
        const blob=await (await fetch(item.dataUrl)).blob();
        totalBytes+=blob.size;
        if(!blob.size||blob.size>MAX_MEDIA_BYTES||totalBytes>MAX_BUNDLE_BYTES||item.size!==undefined&&(!Number.isSafeInteger(Number(item.size))||Number(item.size)!==blob.size))throw new Error('朋友圈备份媒体大小或总量不匹配：'+item.id);
        snapshots.set(item.id,await getMediaRecord(item.id));
        await putMediaBlob(blob,kind,item.name||'',item.id);
        written.push(item.id);
      }
      const required=collectIdsFromState(payload.circleState);
      for(const id of required){if(!provided.has(id))throw new Error('朋友圈备份没有随包包含引用的媒体：'+id);}
      setCircleState(payload.circleState);
      await ensure(payload.circleState);
      for(const id of required){if(!resolve(makeRef(id)))throw new Error('朋友圈备份媒体写入后回读失败：'+id);}
      for(const id of provided){if(!required.has(id)){try{await deleteIfUnreferenced(id);}catch(error){console.warn('[朋友圈媒体] 备份多余媒体清理失败',id,error);}}}
      return true;
    }catch(error){
      if(oldCircle){try{setCircleState(oldCircle);}catch(rollbackError){console.error('[朋友圈媒体] 导入状态回滚失败',rollbackError);}}
      invalidate();
      for(const id of written){
        try{
          const old=snapshots.get(id);
          if(old)await putMediaBlob(old.blob,old.kind||'circle-image',old.name||'',id);
          else await deleteIfUnreferenced(id);
        }catch(rollbackError){console.error('[朋友圈媒体] 导入文件回滚失败',id,rollbackError);}
      }
      if(oldCircle)await ensure(oldCircle).catch(()=>{});
      throw error;
    }finally{endMutation?.();}
  }
  async function cleanupReplaced(oldState,newState){
    const before=collectIdsFromState(oldState),after=collectIdsFromState(newState),removed=[],errors=[];
    for(const id of before){
      if(after.has(id))continue;
      try{const deleted=await deleteIfUnreferenced(id);if(deleted){release(id);removed.push(id);}}
      catch(error){errors.push({id,message:error?.message||String(error)});console.warn('[朋友圈媒体] 旧媒体清理失败，保留待后续清理',id,error);}
    }
    return {checked:Math.max(0,before.size-after.size),deleted:removed.length,errors};
  }
  async function importBackup(payload){
    const endMutation=window.__duoRuntimeCoordinator?.beginMutation?.('导入朋友圈备份');
    try{
      await waitForMigration();
      const oldCircle=getCircleState();
      if(payload?.format==='twodeers-circle-backup'){
        const result=await importBundle(payload);
        await cleanupReplaced(oldCircle,getCircleState());
        return result;
      }
      if(!payload||!Array.isArray(payload.posts)||(!('dynamicCards' in payload)&&!('replyCards' in payload)))throw new Error('不是可识别的朋友圈旧版备份');
      try{
        setCircleState(payload);
        const migrated=await migrateLegacy({allowRestore:true});
        const required=collectIdsFromState(getCircleState());
        await ensure();
        for(const id of required){if(!resolve(makeRef(id)))throw new Error('朋友圈旧备份媒体写入后回读失败：'+id);}
        await cleanupReplaced(oldCircle,getCircleState());
        return {legacy:true,...migrated};
      }catch(error){
        try{setCircleState(oldCircle);invalidate();await ensure(oldCircle);}catch(rollbackError){console.error('[朋友圈媒体] 旧备份导入回滚失败',rollbackError);}
        throw error;
      }
    }finally{endMutation?.();}
  }

  window.__duoCircleMedia={
    prefix:PREFIX,makeRef,parseRef,isDataMediaUrl,collectIdsFromState,getIds,storeBlob,storeDataUrl,
    preserveCircleRecords,verifyPreservedCircleRecords,isAnimatedImageBlob,getOriginalImageKind,requiresOriginalImageBytes,cleanupReplaced,
    resolve,release,invalidate,ensure,ensureRefs,migrateLegacy,waitForMigration,exportBundle,importBundle,importBackup
  };
})();
