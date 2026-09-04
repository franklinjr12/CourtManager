export type WebSession={token:string;user:{name:string;role:string};organization?:{name:string}};
const key='court-manager-session';
export const getSession=()=>JSON.parse(localStorage.getItem(key)??'null') as WebSession|null;
export const setSession=(session:WebSession)=>localStorage.setItem(key,JSON.stringify(session));
export const clearSession=()=>localStorage.removeItem(key);
