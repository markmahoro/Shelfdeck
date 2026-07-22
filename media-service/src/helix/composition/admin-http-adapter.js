'use strict';
const {match}=require('./admin-route-registry');
const mutating=new Set(['POST','PATCH','DELETE']);
function createAdminHttpAdapter(options){return Object.freeze({async dispatch(request){const route=match(request.method,request.path);if(!route)return {status:404,body:{error:{code:'ROUTE_NOT_FOUND',message:'未找到请求入口',details:{},correlationId:request.correlationId}}};if(route.authentication==='admin_session')options.sessionTokens.verify(request.sessionToken,request.nowMs);if(route.sideEffect==='none'&&request.body!==undefined)throw new Error('GET_SIDE_EFFECT_INPUT_REJECTED');if(mutating.has(route.method)&&route.path!=='/v1/admin/session'&&!request.body?.idempotencyKey)throw new Error('IDEMPOTENCY_KEY_REQUIRED');const facade=options.facades[route.facade];if(!facade||typeof facade[route.facadeMethod]!=='function')throw new Error('FACADE_METHOD_UNAVAILABLE');const result=await facade[route.facadeMethod]({params:route.params||{},query:request.query||{},body:request.body,actor:request.actor,correlationId:request.correlationId});return {status:result.status||200,body:result.body};}});}
module.exports=Object.freeze({createAdminHttpAdapter});

