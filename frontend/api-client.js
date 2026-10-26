import {API_ORIGIN} from './api-config.js';
export function apiURL(path){
  if(!path.startsWith('/api/'))throw Error('Invalid API path.');
  return API_ORIGIN?new URL(path,API_ORIGIN).href:path;
}
