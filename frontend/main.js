(() => {
  // Mock datasets and client-side query builder engine only (no API calls)
  const cities = ["Lisbon","Porto","Madrid","Barcelona","Paris","London","Berlin","Rome"]; 
  const segments = ["SMB","Mid-Market","Enterprise"];
  const statuses = ["new","processing","shipped","delivered","cancelled"];
  const random = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const pick = (arr) => arr[random(0, arr.length - 1)];

  const products = Array.from({length: 20}).map((_, i) => ({ id: i+1, name: `Product ${i+1}`, category: pick(["Hardware","Software","Service"]), price: Number((Math.random()*500+10).toFixed(2)) }));
  const customers = Array.from({length: 100}).map((_, i) => {
    const name = `Customer ${i+1}`;
    return { id: i+1, name, email: `${name.toLowerCase().replace(/\s+/g,'')}@example.com`, city: pick(cities), segment: pick(segments), signupDate: new Date(2020 + random(0, 4), random(0, 11), random(1, 28)).toISOString() };
  });
  const orders = Array.from({length: 300}).map((_, i) => {
    const customerId = random(1, customers.length);
    const productId = random(1, products.length);
    const quantity = random(1, 5);
    const price = products[productId-1].price;
    return { id: i+1, customerId, productId, date: new Date(2021 + random(0,3), random(0,11), random(1,28)).toISOString(), quantity, total: Number((quantity*price).toFixed(2)), status: pick(statuses) };
  });
  const MOCK = { customers, orders, products };

  const datasetSelect = document.getElementById('datasetSelect');
  const fieldChips = document.getElementById('fieldChips');
  const pipelineList = document.getElementById('pipelineList');
  const resultMeta = document.getElementById('resultMeta');
  const tableContainer = document.getElementById('tableContainer');
  const queryJson = document.getElementById('queryJson');
  const presetSelect = document.getElementById('presetSelect');

  Object.keys(MOCK).forEach(n => { const o=document.createElement('option'); o.value=n; o.textContent=n; datasetSelect.appendChild(o); });
  datasetSelect.value = 'orders';
  datasetSelect.addEventListener('change', () => { renderFieldChips(); runAndRenderDebounced(); });

  document.querySelectorAll('#qb [data-step]').forEach(btn => btn.addEventListener('click', () => {
    const type = btn.getAttribute('data-step');
    pipelineList.appendChild(createStepEl(type));
    runAndRenderDebounced();
  }));

  document.getElementById('btnRun').addEventListener('click', () => runAndRender());
  document.getElementById('btnClear').addEventListener('click', () => { pipelineList.innerHTML=''; runAndRender(); });

  document.getElementById('btnSavePreset').addEventListener('click', () => {
    const name = prompt('Preset name?'); if(!name) return;
    const all = loadPresets();
    all[name] = { dataset: datasetSelect.value, steps: readPipeline() };
    savePresets(all); refreshPresetSelect(); alert('Saved');
  });
  document.getElementById('btnLoadPreset').addEventListener('click', () => {
    const name = presetSelect.value; if(!name) return;
    const p = loadPresets()[name]; if(!p) return;
    datasetSelect.value = p.dataset; pipelineList.innerHTML = '';
    p.steps.forEach(s => pipelineList.appendChild(createStepEl(s.type, s)));
    renderFieldChips();
    runAndRender();
  });
  document.getElementById('btnExportCsv').addEventListener('click', () => exportCsv(window.__lastResult||[]));
  document.getElementById('btnExportJson').addEventListener('click', () => exportJson(window.__lastResult||[]));
  refreshPresetSelect();

  // Live updates (debounced)
  pipelineList.addEventListener('input', () => runAndRenderDebounced());
  pipelineList.addEventListener('change', () => runAndRenderDebounced());

  // ----- Field chips -----
  function renderFieldChips(){
    fieldChips.innerHTML = '';
    const base = datasetSelect.value;
    const mkChip = (label, field) => {
      const c = document.createElement('span'); c.className='chip'; c.draggable=true; c.textContent=label; c.dataset.field=field;
      c.addEventListener('dragstart', (e)=> e.dataTransfer.setData('text/plain', field));
      fieldChips.appendChild(c);
    };
    // Base dataset fields
    const baseRow = (MOCK[base] && MOCK[base][0]) || {};
    Object.keys(baseRow).forEach(k => mkChip(k, k));
    // Prefixed fields for all datasets
    Object.keys(MOCK).forEach(ds => {
      const row = (MOCK[ds] && MOCK[ds][0]) || {};
      Object.keys(row).forEach(k => mkChip(`${ds}.${k}`, `${ds}.${k}`));
    });
  }

  // ----- Pipeline step creation -----
  function createStepEl(type, data={}){
    const li=document.createElement('li'); li.className='step'; li.dataset.type=type; li.draggable=true;
    attachStepDnD(li);
    const title = type[0].toUpperCase()+type.slice(1);
    const header=document.createElement('div'); header.className='step-header'; header.innerHTML=`<span class="step-title">${title}</span><div class="spacer"></div><button type="button" class="btn-remove">Remove</button>`; header.querySelector('.btn-remove').addEventListener('click', ()=>{li.remove(); runAndRenderDebounced();}); li.appendChild(header);
    const body=document.createElement('div');
    switch(type){
      case 'filter': body.innerHTML=`<small>Keep rows where</small><div class="actions wrap"><input name="field" placeholder="field" value="${esc(data.field||'')}" /><select name="op">${['equals','notEquals','contains','startsWith','endsWith','gt','gte','lt','lte','in'].map(o=>`<option ${data.op===o?'selected':''}>${o}</option>`).join('')}</select><input name="value" placeholder="value or comma-list for in" value="${esc(data.value||'')}" /></div>`; enableDroppableInput(body.querySelector('[name=field]')); break;
      case 'join': body.innerHTML=`<small>Join with dataset</small><div class="actions wrap"><select name="dataset">${Object.keys(MOCK).map(n=>`<option ${data.dataset===n?'selected':''}>${n}</option>`).join('')}</select><input name="leftKey" placeholder="left key" value="${esc(data.leftKey||'')}" /><input name="rightKey" placeholder="right key" value="${esc(data.rightKey||'')}" /><select name="kind">${['inner','left'].map(k=>`<option ${data.kind===k?'selected':''}>${k}</option>`).join('')}</select></div><small>Joined fields are prefixed</small>`; enableDroppableInput(body.querySelector('[name=leftKey]')); enableDroppableInput(body.querySelector('[name=rightKey]')); break;
      case 'group': body.innerHTML=`<small>Group by</small><div class="actions wrap"><input name="groupBy" placeholder="comma separated fields" value="${esc((data.groupBy||[]).join(', '))}" /></div><div class="aggs"></div><div class="actions wrap"><button type="button" class="btn-add-agg">+ Add aggregate</button></div>`; const aggsEl=document.createElement('div'); aggsEl.className='aggs'; body.appendChild(aggsEl); (data.aggregates||[{op:'count',field:'*',as:'count'}]).forEach(a=>aggsEl.appendChild(createAggRow(a))); body.querySelector('.btn-add-agg').addEventListener('click', ()=>aggsEl.appendChild(createAggRow({op:'count',field:'*',as:'count'}))); enableDroppableInput(body.querySelector('[name=groupBy]'), {list:true}); break;
      case 'pivot': body.appendChild(createPivotBody(data)); break;
      case 'compute': body.innerHTML=`<small>Create a new field</small><div class="actions wrap"><input name="as" placeholder="field name" value="${esc(data.as||'')}" /><input name="expr" placeholder="JS expression using r" value="${esc(data.expr||'')}" /></div>`; break;
      case 'select': body.innerHTML=`<small>Select and rename columns</small><input name="fields" style="width:100%" placeholder="id, name, total, city as customerCity" value="${esc(data.fields||'')}" />`; enableDroppableInput(body.querySelector('[name=fields]'), {list:true}); break;
      case 'sort': body.innerHTML=`<small>Sort by</small><input name="orders" style="width:100%" placeholder="date desc, total desc" value="${esc((data.orders||[]).join(', '))}" />`; enableDroppableInput(body.querySelector('[name=orders]'), {list:true}); break;
      case 'limit': body.innerHTML=`<small>Slice</small><div class="actions wrap"><input type="number" name="offset" placeholder="offset" value="${Number(data.offset||0)}" /><input type="number" name="limit" placeholder="limit" value="${Number(data.limit||100)}" /></div>`; break;
    }
    li.appendChild(body); return li;
  }
  function createAggRow(a){ const row=document.createElement('div'); row.className='actions wrap'; row.innerHTML=`<select name="op">${['count','sum','avg','min','max'].map(op=>`<option ${a.op===op?'selected':''}>${op}</option>`).join('')}</select><input name="field" placeholder="field or *" value="${esc(a.field||'*')}" /><input name="as" placeholder="as (alias)" value="${esc(a.as||'value')}" /><button type="button" class="btn-remove-agg">Remove</button>`; row.querySelector('.btn-remove-agg').addEventListener('click', ()=>row.remove()); enableDroppableInput(row.querySelector('[name=field]')); return row; }
  function createPivotBody(data){
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="actions wrap"><small>Rows</small><div class="droppable rows"></div></div>
      <div class="actions wrap"><small>Columns</small><div class="droppable cols"></div></div>
      <div class="actions wrap"><small>Values</small><div class="droppable vals"></div></div>`;
    const rowsEl = wrap.querySelector('.rows'); const colsEl = wrap.querySelector('.cols'); const valsEl = wrap.querySelector('.vals');
    enableDroppableList(rowsEl, 'field'); enableDroppableList(colsEl, 'field'); enableDroppableValues(valsEl);
    (data.rows||[]).forEach(f => addChip(rowsEl, f));
    (data.cols||[]).forEach(f => addChip(colsEl, f));
    (data.values||[]).forEach(v => addValue(valsEl, v.field, v.op||'sum'));
    return wrap;
  }

  // ----- Drag-and-drop helpers -----
  function enableDroppableInput(input, opts={}){
    input.addEventListener('dragover', e => { e.preventDefault(); input.classList.add('dragover'); });
    input.addEventListener('dragleave', () => input.classList.remove('dragover'));
    input.addEventListener('drop', e => { e.preventDefault(); input.classList.remove('dragover'); const field = e.dataTransfer.getData('text/plain'); if(!field) return; if(opts.list){ input.value = (input.value ? input.value + ', ' : '') + field; } else { input.value = field; } runAndRenderDebounced(); });
  }
  function addChip(container, field){ const s=document.createElement('span'); s.className='chip'; s.textContent=field; s.dataset.field=field; s.draggable=true; s.addEventListener('dragstart', e=> e.dataTransfer.setData('text/plain', field)); s.addEventListener('click', ()=>{ s.remove(); runAndRenderDebounced(); }); container.appendChild(s); }
  function enableDroppableList(container){ container.classList.add('droppable'); container.addEventListener('dragover', e=>{ e.preventDefault(); container.classList.add('dragover'); }); container.addEventListener('dragleave', ()=> container.classList.remove('dragover')); container.addEventListener('drop', e=>{ e.preventDefault(); container.classList.remove('dragover'); const field=e.dataTransfer.getData('text/plain'); if(field) { addChip(container, field); runAndRenderDebounced(); } }); }
  function addValue(container, field, op){ const row=document.createElement('div'); row.className='actions wrap'; row.innerHTML=`<select name="op">${['sum','count','avg','min','max'].map(o=>`<option ${op===o?'selected':''}>${o}</option>`).join('')}</select><span class="chip" data-field="${field}">${field}</span><button type="button">Remove</button>`; const btn=row.querySelector('button'); btn.addEventListener('click', ()=>{ row.remove(); runAndRenderDebounced(); }); const chip=row.querySelector('.chip'); chip.draggable=true; chip.addEventListener('dragstart', e=> e.dataTransfer.setData('text/plain', field)); container.appendChild(row); }
  function enableDroppableValues(container){ container.classList.add('droppable'); container.addEventListener('dragover', e=>{ e.preventDefault(); container.classList.add('dragover'); }); container.addEventListener('dragleave', ()=> container.classList.remove('dragover')); container.addEventListener('drop', e=>{ e.preventDefault(); container.classList.remove('dragover'); const field=e.dataTransfer.getData('text/plain'); if(field){ addValue(container, field, 'sum'); runAndRenderDebounced(); } }); }

  // Pipeline DnD reorder
  let dragStepEl = null;
  function attachStepDnD(li){
    li.addEventListener('dragstart', ()=> { dragStepEl = li; });
    li.addEventListener('dragover', e => { e.preventDefault(); });
    li.addEventListener('drop', e => { e.preventDefault(); if(!dragStepEl || dragStepEl===li) return; const siblings = Array.from(pipelineList.children); const srcIdx = siblings.indexOf(dragStepEl); const dstIdx = siblings.indexOf(li); if(srcIdx < dstIdx){ pipelineList.insertBefore(dragStepEl, li.nextSibling); } else { pipelineList.insertBefore(dragStepEl, li); } runAndRenderDebounced(); });
  }

  // ----- Read/Run pipeline -----
  function readPipeline(){ const steps=[]; pipelineList.querySelectorAll('.step').forEach(stepEl=>{ const type=stepEl.dataset.type; const q=s=>stepEl.querySelector(s); switch(type){ case 'filter': steps.push({ type, field: q('[name=field]')?.value?.trim(), op: q('[name=op]')?.value, value: q('[name=value]')?.value }); break; case 'join': steps.push({ type, dataset: q('[name=dataset]')?.value, leftKey: q('[name=leftKey]')?.value?.trim(), rightKey: q('[name=rightKey]')?.value?.trim(), kind: q('[name=kind]')?.value }); break; case 'group': const groupBy=(q('[name=groupBy]')?.value||'').split(',').map(s=>s.trim()).filter(Boolean); const aggregates=Array.from(stepEl.querySelectorAll('.aggs .actions')).map(r=>({ op:r.querySelector('[name=op]')?.value, field:r.querySelector('[name=field]')?.value?.trim()||'*', as:r.querySelector('[name=as]')?.value?.trim()||'value' })); steps.push({ type, groupBy, aggregates }); break; case 'pivot': const rows=Array.from(stepEl.querySelectorAll('.rows .chip')).map(c=>c.dataset.field); const cols=Array.from(stepEl.querySelectorAll('.cols .chip')).map(c=>c.dataset.field); const values=Array.from(stepEl.querySelectorAll('.vals .actions')).map(v=>({ op: v.querySelector('[name=op]')?.value || 'sum', field: v.querySelector('.chip')?.dataset.field })); steps.push({ type, rows, cols, values }); break; case 'compute': steps.push({ type, as: q('[name=as]')?.value?.trim(), expr: q('[name=expr]')?.value }); break; case 'select': steps.push({ type, fields: q('[name=fields]')?.value }); break; case 'sort': steps.push({ type, orders: (q('[name=orders]')?.value||'').split(',').map(s=>s.trim()).filter(Boolean) }); break; case 'limit': steps.push({ type, offset: Number(q('[name=offset]')?.value||0), limit: Number(q('[name=limit]')?.value||100) }); break; }}); return steps; }

  let columnOrder = null;
  function runAndRender(){ const dataset=datasetSelect.value; const steps=readPipeline(); const result=runPipeline(MOCK[dataset], steps); window.__lastResult=result; renderTable(result); resultMeta.textContent=`${result.length} rows`; queryJson.textContent=JSON.stringify({dataset,steps}, null, 2); }
  const runAndRenderDebounced = debounce(runAndRender, 200);

  function runPipeline(data, steps){ let rows=data.map(r=>({...r})); for(const step of steps){ switch(step.type){ case 'filter': rows=applyFilter(rows, step); break; case 'join': rows=applyJoin(rows, step); break; case 'group': rows=applyGroup(rows, step); break; case 'pivot': rows=applyPivot(rows, step); break; case 'compute': rows=applyCompute(rows, step); break; case 'select': rows=applySelect(rows, step); break; case 'sort': rows=applySort(rows, step); break; case 'limit': rows=applyLimit(rows, step); break; } } return rows; }
  function applyFilter(rows,{field,op,value}){ const vals=typeof value==='string'?value.split(',').map(v=>coerce(v.trim())):[value]; return rows.filter(r=>{ const v=get(r,field); switch(op){ case 'equals': return v==vals[0]; case 'notEquals': return v!=vals[0]; case 'contains': return String(v??'').toLowerCase().includes(String(vals[0]??'').toLowerCase()); case 'startsWith': return String(v??'').toLowerCase().startsWith(String(vals[0]??'').toLowerCase()); case 'endsWith': return String(v??'').toLowerCase().endsWith(String(vals[0]??'').toLowerCase()); case 'gt': return Number(v)>Number(vals[0]); case 'gte': return Number(v)>=Number(vals[0]); case 'lt': return Number(v)<Number(vals[0]); case 'lte': return Number(v)<=Number(vals[0]); case 'in': return vals.some(x=>x==v); default: return true; } }); }
  function applyJoin(rows,{dataset,leftKey,rightKey,kind}){ const right=(MOCK[dataset]||[]); const index=new Map(); right.forEach(r=>index.set(get(r,rightKey),r)); const prefix=dataset+'.'; const out=[]; for(const l of rows){ const rv=index.get(get(l,leftKey)); if(rv){ out.push({...l, ...prefixKeys(rv,prefix)}); } else if(kind==='left'){ out.push({...l}); } } return out; }
  function applyGroup(rows,{groupBy,aggregates}){ const keyFn=r=>JSON.stringify(groupBy.map(k=>get(r,k))); const groups=new Map(); for(const r of rows){ const k=keyFn(r); if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(r); } const out=[]; for(const [key,arr] of groups){ const obj={}; groupBy.forEach((k,i)=>obj[k]=get(arr[0],k)); for(const agg of aggregates){ const fld=agg.field==='*'?undefined:agg.field; const vals=fld?arr.map(r=>Number(get(r,fld))).filter(x=>!isNaN(x)):arr; let val=null; switch(agg.op){ case 'count': val=arr.length; break; case 'sum': val=vals.reduce((a,b)=>a+b,0); break; case 'avg': val=vals.reduce((a,b)=>a+b,0)/(vals.length||1); break; case 'min': val=Math.min(...vals); break; case 'max': val=Math.max(...vals); break; } obj[agg.as||`${agg.op}_${agg.field}`]=Number.isFinite(val)?Number(val.toFixed(4)):val; } out.push(obj); } return out; }
  function applyPivot(rows,{rows:rowFields=[], cols:colFields=[], values=[]}){
    if(!values || !values.length){ values = [{op:'count', field:'*'}]; }
    const rowKey = r => JSON.stringify(rowFields.map(f=>get(r,f)));
    const colKey = r => JSON.stringify(colFields.map(f=>get(r,f)));
    const rowGroups = new Map();
    const colSet = new Set();
    for(const r of rows){ const rk=rowKey(r); const ck=colKey(r); if(!rowGroups.has(rk)) rowGroups.set(rk, []); rowGroups.get(rk).push(r); colSet.add(ck); }
    const colKeys = Array.from(colSet);
    const wide = [];
    for(const [rk, arr] of rowGroups){
      const obj = {};
      rowFields.forEach((f,i)=> obj[f] = get(arr[0], f));
      for(const ck of (colKeys.length? colKeys : [JSON.stringify([])])){
        const sub = arr.filter(r => colKey(r) === ck);
        for(const v of values){
          const label = `${v.op}(${v.field})` + (colFields.length? ` | ${JSON.parse(ck).join(' / ')}` : '');
          obj[label] = aggregate(sub, v);
        }
      }
      wide.push(obj);
    }
    return wide;
  }
  function aggregate(rows, {op, field}){
    if(op==='count') return rows.length;
    const vals = rows.map(r => Number(get(r, field))).filter(x => !isNaN(x));
    if(!vals.length) return null;
    switch(op){
      case 'sum': return Number(vals.reduce((a,b)=>a+b,0).toFixed(4));
      case 'avg': return Number((vals.reduce((a,b)=>a+b,0) / vals.length).toFixed(4));
      case 'min': return Math.min(...vals);
      case 'max': return Math.max(...vals);
      default: return null;
    }
  }
  function applyCompute(rows,{as,expr}){ const fn=safeExpr(expr); return rows.map(r=>({...r,[as]:fn(r)})); }
  function applySelect(rows,{fields}){ const tokens=(fields||'').split(',').map(s=>s.trim()).filter(Boolean); const specs=tokens.map(t=>{ const m=t.match(/^(.*?)\s+as\s+(.*)$/i); if(m) return {from:m[1].trim(), as:m[2].trim()}; return {from:t, as:t.replace(/[^a-zA-Z0-9_.]/g,'_')}; }); return rows.map(r=>{ const o={}; for(const s of specs){ o[s.as]=get(r,s.from); } return o; }); }
  function applySort(rows,{orders}){ const sorters=orders.map(o=>{ const m=o.match(/^(.*?)\s+(asc|desc)$/i); if(m) return {field:m[1].trim(), dir:m[2].toLowerCase()}; return {field:o, dir:'asc'}; }); return [...rows].sort((a,b)=>{ for(const s of sorters){ const av=get(a,s.field), bv=get(b,s.field); if(av==bv) continue; const cmp=av>bv?1:-1; return s.dir==='desc'? -cmp : cmp; } return 0; }); }
  function applyLimit(rows,{offset=0,limit=100}){ return rows.slice(offset, offset+limit); }

  // ----- Table rendering with draggable columns -----
  function renderTable(rows){
    if(!Array.isArray(rows)||rows.length===0){ tableContainer.innerHTML='<p>No data</p>'; return; }
    const allCols = Array.from(rows.reduce((set,r)=>{Object.keys(r).forEach(k=>set.add(k)); return set;}, new Set()));
    if(!columnOrder) columnOrder = allCols.slice();
    const cols = columnOrder.filter(c => allCols.includes(c)).concat(allCols.filter(c=>!columnOrder.includes(c)));
    const thead = document.createElement('thead'); const tr=document.createElement('tr'); thead.appendChild(tr);
    cols.forEach(c => { const th=document.createElement('th'); th.textContent=c; th.draggable=true; th.addEventListener('dragstart', e=> e.dataTransfer.setData('text/plain', c)); th.addEventListener('dragover', e=> e.preventDefault()); th.addEventListener('drop', e=>{ e.preventDefault(); const src=e.dataTransfer.getData('text/plain'); if(!src) return; const srcIdx=columnOrder.indexOf(src); const dstIdx=columnOrder.indexOf(c); if(srcIdx<0||dstIdx<0||src===c) return; const arr=columnOrder.slice(); arr.splice(dstIdx,0, arr.splice(srcIdx,1)[0]); columnOrder=arr; renderTable(rows); }); tr.appendChild(th); });
    const tbody = document.createElement('tbody');
    rows.forEach(r => { const tr=document.createElement('tr'); cols.forEach(c => { const td=document.createElement('td'); td.textContent = formatCell(r[c]); tr.appendChild(td); }); tbody.appendChild(tr); });
    const table = document.createElement('table'); table.appendChild(thead); table.appendChild(tbody); tableContainer.innerHTML=''; tableContainer.appendChild(table);
  }
  function formatCell(v){ if(v===null||v===undefined) return ''; if(typeof v==='object') return JSON.stringify(v); return String(v); }

  // ----- Utilities -----
  function get(obj,path){ if(!path) return undefined; return path.split('.').reduce((o,k)=>(o==null?undefined:o[k]), obj); }
  function prefixKeys(obj,prefix){ const o={}; Object.keys(obj).forEach(k=>o[prefix+k]=obj[k]); return o; }
  function coerce(v){ if(v==='') return v; if(v==='true') return true; if(v==='false') return false; const n=Number(v); if(!isNaN(n)) return n; const d=new Date(v); if(!isNaN(d.getTime())) return d.toISOString(); return v; }
  function safeExpr(expr){ try{ const h={ parseDate:(x)=>new Date(x), year:(x)=>new Date(x).getFullYear(), month:(x)=>new Date(x).getMonth()+1, day:(x)=>new Date(x).getDate(), lower:(x)=>String(x||'').toLowerCase(), upper:(x)=>String(x||'').toUpperCase(), len:(x)=> (x==null?0:String(x).length), coalesce:(...xs)=> xs.find(x=>x!=null&&x!=='') }; const fn=new Function('r','h', `return (${expr||'undefined'})`); return (r)=>{ try{ return fn(r,h);}catch{ return null;} }; }catch{ return ()=>null; } }
  function esc(s){ return (s||'').replace(/["&<>]/g, c=>({'"':'&quot;','&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  function exportCsv(rows){ if(!rows.length) return alert('No rows'); const cols=Array.from(rows.reduce((s,r)=>{Object.keys(r).forEach(k=>s.add(k)); return s;}, new Set())); const escCsv=x=>{ if(x==null) return ''; x=String(x).replace(/"/g,'""'); if(/[",\n]/.test(x)) return '"'+x+'"'; return x; }; const csv=[cols.join(',')].concat(rows.map(r=>cols.map(c=>escCsv(r[c])).join(','))).join('\n'); const blob=new Blob([csv],{type:'text/csv'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='results.csv'; a.click(); URL.revokeObjectURL(url); }
  function exportJson(rows){ const blob=new Blob([JSON.stringify(rows,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='results.json'; a.click(); URL.revokeObjectURL(url); }
  function loadPresets(){ try{ return JSON.parse(localStorage.getItem('qb_presets')||'{}'); } catch{ return {}; } }
  function savePresets(data){ localStorage.setItem('qb_presets', JSON.stringify(data)); }
  function refreshPresetSelect(){ const all=loadPresets(); presetSelect.innerHTML=''; Object.keys(all).forEach(name=>{ const opt=document.createElement('option'); opt.value=name; opt.textContent=name; presetSelect.appendChild(opt); }); }
  function debounce(fn, ms){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); } }

  // Default demo
  renderFieldChips();
  pipelineList.appendChild(createStepEl('join', { dataset: 'customers', leftKey: 'customerId', rightKey: 'id', kind: 'inner' }));
  pipelineList.appendChild(createStepEl('pivot', { rows: ['customers.city'], cols: ['status'], values: [{op:'sum', field:'total'}] }));
  runAndRender();
})();


