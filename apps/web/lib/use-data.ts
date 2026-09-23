"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export function useData<T>(path: string | null) {
  const [data,setData]=useState<T|null>(null); const [error,setError]=useState<Error|null>(null); const [loading,setLoading]=useState(Boolean(path));
  const reload=useCallback(async()=>{if(!path)return;setLoading(true);setError(null);try{setData(await api<T>(path));}catch(e){setError(e as Error);}finally{setLoading(false);}},[path]);
  useEffect(()=>{void reload();},[reload]);
  return {data,error,loading,reload,setData};
}
