interface Storage {
  sql: { exec(query: string, ...bindings: (string | number)[]): Iterable<Record<string, unknown>> };
  transactionSync<T>(callback: () => T): T;
}
function reply(status: number, retry: number): Response {
  return new Response(null,{status,headers:{'retry-after':String(retry),'cache-control':'no-store'}});
}

// Fetch-only DO, reachable through its binding; no public Worker route exposes it.
export class CreationLimiter {
  private storage: Storage;
  constructor(state: {storage: Storage}, _env: unknown, private now: () => number = Date.now) {
    this.storage=state.storage;
  }
  async fetch(request: Request): Promise<Response> {
    if(request.method!=='POST' || new URL(request.url).pathname!=='/consume')return reply(400,60);
    try {
      const {key}=await request.json() as {key?: unknown};
      if(typeof key!=='string' || !/^[a-f0-9]{64}$/.test(key))return reply(400,60);
      const time=this.now(), window=Math.floor(time/60000);
      const retry=Math.max(1,Math.ceil(((window+1)*60000-time)/1000));
      // No await between reads and writes. A rejected pair consumes neither counter.
      return this.storage.transactionSync(()=>{
        const sql=this.storage.sql;
        sql.exec('CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL)');
        sql.exec('DELETE FROM counters WHERE window <> ?',window);
        const count=(name: string)=>Number([...sql.exec('SELECT count FROM counters WHERE key = ?',name)][0]?.count ?? 0);
        if(count('global')>=20 || count(key)>=5)return reply(429,retry);
        for(const name of ['global',key])sql.exec('INSERT INTO counters VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET count = count + 1',name,window);
        return reply(200,retry);
      });
    } catch { return reply(503,60); }
  }
}
