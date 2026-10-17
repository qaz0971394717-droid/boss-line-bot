export async function fetchLineReply(url,options,fetcher=fetch,timeoutMs=12000){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const response=await fetcher(url,{...options,signal:controller.signal,redirect:'manual'});
  if(response.status>=300&&response.status<400)throw TypeError('LINE redirect rejected');
  return response;
 }finally{clearTimeout(timer);}
}
