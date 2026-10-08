/* Presupuestos internos INPERU. No publica datos privados ni altera costos/libros. */
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const copy = value => JSON.parse(JSON.stringify(value));
    const money = value => formatMoney(value);
    const esc = value => escapeHtml(value);
    const states = ['Borrador', 'Enviado', 'Aceptado', 'Rechazado', 'Vencido'];
    const numericLimit = 1000000000;
    let quotes = [], clients = [], products = [], draft = null;
    let dirty = false, busy = false, ready = false, session = 0, stops = [];
    let productEditId = null, productEditUpdatedAt = null, productBusy = false;

    function today(offset = 0) {
        const date = new Date();
        date.setDate(date.getDate() + offset);
        return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    }
    function dateLabel(value) {
        const parts = String(value).split('-');
        return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : String(value);
    }
    function round(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }
    function number(value, name, min = 0, max = numericLimit) {
        if (String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max) {
            throw new Error(`${name}: ingresá un número entre ${min} y ${max}.`);
        }
        return round(Number(value));
    }
    function phoneDigits(phone) { return String(phone).replace(/\D/g, ''); }
    function validPhone(phone) { return /^[0-9]{10,15}$/.test(phoneDigits(phone)); }
    function totals(record) {
        const subtotal = round(record.items.reduce((sum, row) => sum + round(Number(row.qty || 0) * Number(row.unitPrice || 0)), 0));
        const discountAmount = round(subtotal * Number(record.discount || 0) / 100);
        const total = round(subtotal - discountAmount + Number(record.delivery || 0));
        return { subtotal, discountAmount, total, balance: round(total - Number(record.deposit || 0)) };
    }
    function status(record) {
        return ['Borrador','Enviado'].includes(record.status) && record.validUntil < today() ? 'Vencido' : record.status;
    }
    function msg(text, error = false) {
        const notice = $('pq-notice');
        notice.textContent = text;
        notice.style.color = error ? '#fda4af' : '#99f6e4';
        notice.setAttribute('role', error ? 'alert' : 'status');
    }
    function canLeave() {
        if (busy || productBusy) { showToastMessage('Esperá a que termine de guardar.'); return false; }
        if (dirty && !confirm('Hay cambios del presupuesto sin guardar. ¿Querés descartarlos?')) return false;
        if (dirty) { draft = null; dirty = false; $('pq-editor').hidden = true; }
        return true;
    }
    function mount() {
        $('tab-budgets').innerHTML = `
            <div class="pq-heading"><div><h2>Presupuestos</h2><p class="pq-muted">Clientes, libros y productos · PDF listo para compartir</p></div>
            <div class="pq-actions"><button type="button" class="pq-button" data-action="manager">Productos</button><button type="button" class="pq-button primary" data-action="new">+ Nuevo presupuesto</button></div></div>
            <div id="pq-notice" class="pq-notice" role="status">Ingresá para cargar los presupuestos.</div>
            <div id="pq-manager" class="pq-card" hidden>
                <h3>Productos guardados</h3><p class="pq-muted">Para cuadros de Foam, impresiones y otros servicios. Son privados y no se publican en la biblioteca.</p>
                <form id="pq-product-form"><div class="pq-grid three" style="margin-top:12px">
                    <label class="pq-field">Nombre<input id="pq-product-name" maxlength="200" required></label>
                    <label class="pq-field">Precio unitario ($)<input id="pq-product-price" type="number" min="0" max="1000000000" step="0.01" required></label>
                    <label class="pq-field">Detalle<input id="pq-product-description" maxlength="500"></label>
                </div><div class="pq-actions" style="margin-top:12px"><button class="pq-button primary" type="submit" id="pq-product-save">Guardar producto</button><button class="pq-button" type="button" data-action="product-cancel">Limpiar / nuevo</button></div></form>
                <div id="pq-products" class="pq-list"></div>
            </div>
            <form id="pq-editor" hidden>
                <div class="pq-card"><div class="pq-heading"><h3 id="pq-number">Número automático al guardar</h3><button type="button" class="pq-button" data-action="close">Cerrar editor</button></div>
                    <div class="pq-grid three">
                        <label class="pq-field">Fecha<input id="pq-date" type="date" required></label>
                        <label class="pq-field">Válido hasta<input id="pq-valid" type="date" required></label>
                        <label class="pq-field">Estado<select id="pq-state">${states.map(s=>`<option>${s}</option>`).join('')}</select></label>
                    </div>
                </div>
                <div class="pq-card"><h3>Cliente</h3>
                    <label class="pq-field">Elegir cliente guardado<select id="pq-client"><option value="">Nuevo cliente</option></select></label>
                    <div class="pq-grid" style="margin-top:14px">
                        <label class="pq-field">Nombre / razón social<input id="pq-name" maxlength="200" required autocomplete="name"></label>
                        <label class="pq-field">Celular con código de país<input id="pq-phone" type="tel" maxlength="30" placeholder="Ej.: 549 + código de área + número" required autocomplete="tel"></label>
                        <label class="pq-field">Email (opcional)<input id="pq-email" type="email" maxlength="200"></label>
                        <label class="pq-field">Dirección (opcional)<input id="pq-address" maxlength="300"></label>
                    </div><p class="pq-muted">El cliente se guarda junto con el presupuesto. Los datos anteriores del PDF no cambian si después editás al cliente.</p>
                </div>
                <div class="pq-card"><h3>Productos y cantidades</h3>
                    <div class="pq-grid"><label class="pq-field">Libro del catálogo<select id="pq-book"><option value="">Elegir libro…</option></select></label>
                    <label class="pq-field">Otro producto guardado<select id="pq-product"><option value="">Elegir producto…</option></select></label></div>
                    <div class="pq-actions" style="margin-top:12px"><button type="button" class="pq-button" data-action="add-book">+ Agregar libro</button><button type="button" class="pq-button" data-action="add-product">+ Agregar producto</button><button type="button" class="pq-button" data-action="add-free">+ Concepto libre</button><button type="button" class="pq-button" data-action="refresh-prices">Actualizar precios actuales</button></div>
                    <p class="pq-muted">Podés editar descripción, cantidad y precio. Los precios guardados quedan fijos. Máximo 100 renglones.</p>
                    <div id="pq-items" class="pq-items"></div>
                </div>
                <div class="pq-card"><h3>Condiciones y totales</h3><div class="pq-grid three">
                    <label class="pq-field">Descuento (%)<input id="pq-discount" type="number" min="0" max="100" step="0.01"></label>
                    <label class="pq-field">Entrega / envío ($)<input id="pq-delivery" type="number" min="0" max="1000000000" step="0.01"></label>
                    <label class="pq-field">Seña / anticipo ($)<input id="pq-deposit" type="number" min="0" max="1000000000" step="0.01"></label>
                    <label class="pq-field">Forma de pago<input id="pq-payment" maxlength="200" placeholder="Transferencia, efectivo…"></label>
                    <label class="pq-field">Plazo de entrega<input id="pq-deadline" maxlength="200" placeholder="Ej.: 3 días hábiles desde la seña"></label>
                    <label class="pq-field">Contacto INPERU (opcional)<input id="pq-contact" maxlength="200" placeholder="Celular, email o dirección"></label>
                    <label class="pq-field pq-wide">Especificaciones / observaciones para el cliente<textarea id="pq-notes" maxlength="3000" placeholder="Calidad, terminaciones, entrega, condiciones…"></textarea></label>
                </div><div class="pq-summary"><div><span>Subtotal</span><span id="pq-subtotal"></span></div><div><span>Descuento</span><span id="pq-discount-total"></span></div><div class="total"><span>Total ARS</span><span id="pq-total"></span></div><div><span>Saldo tras seña</span><span id="pq-balance"></span></div></div></div>
                <div class="pq-bottom pq-actions"><button id="pq-save" type="submit" class="pq-button primary">Guardar presupuesto</button><span id="pq-save-status" class="pq-muted">PDF y WhatsApp disponibles después de guardar.</span></div>
            </form>
            <div class="pq-card"><h3>Presupuestos guardados</h3><label class="pq-field">Buscar por número, cliente, celular o producto<input id="pq-search" type="search" placeholder="Buscar…"></label><div id="pq-list" class="pq-list"></div></div>`;
        $('tab-budgets').addEventListener('click', handleClick);
        $('pq-editor').addEventListener('input', () => { dirty = true; preview(); });
        $('pq-editor').addEventListener('change', () => { dirty = true; preview(); });
        $('pq-client').addEventListener('change', selectClient);
        $('pq-editor').addEventListener('submit', save);
        $('pq-product-form').addEventListener('submit', saveProduct);
        $('pq-search').addEventListener('input', renderList);
    }
    function fillSelect(id, options, placeholder) {
        const select = $(id), previous = select.value;
        select.innerHTML = `<option value="">${placeholder}</option>` + options.map(o=>`<option value="${esc(o.id)}">${esc(o.title || o.name)}</option>`).join('');
        select.value = previous;
    }
    function renderOptions() {
        fillSelect('pq-client', [...clients].sort((a,b)=>a.name.localeCompare(b.name,'es')), 'Nuevo cliente');
        fillSelect('pq-book', [...catalog].sort((a,b)=>a.title.localeCompare(b.title,'es')), 'Elegir libro…');
        fillSelect('pq-product', [...products].sort((a,b)=>a.name.localeCompare(b.name,'es')), 'Elegir producto…');
    }
    function render() {
        renderOptions(); renderList(); renderProducts();
        if (localPreviewActive) { ready = true; msg('Modo prueba: datos temporales. No se guardan en Firebase y la numeración no es definitiva.'); }
    }
    function startSync() {
        stopSync();
        if (!canUseCloud()) return;
        const currentSession = session;
        const loaded = new Set();
        msg('Cargando presupuestos, clientes y productos…');
        [['quotes',v=>quotes=v],['clients',v=>clients=v],['products',v=>products=v]].forEach(([name,assign])=> {
            stops.push(db.collection(name).onSnapshot({ includeMetadataChanges:true }, snapshot => {
                if (currentSession !== session) return;
                const list = []; snapshot.forEach(doc=>list.push({ ...doc.data(), id:doc.id })); assign(list);
                if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) loaded.add(name);
                ready = loaded.size === 3;
                renderOptions(); renderList(); renderProducts();
                if (!busy) msg(ready ? 'Datos privados cargados. Los presupuestos guardados mantienen su precio.' : 'Verificando datos con la nube…');
            }, error => {
                if (currentSession !== session) return;
                ready = false;
                msg(error.code === 'permission-denied' ? 'Falta publicar las reglas Firestore v19 para presupuestos, clientes y productos.' : 'No se pudieron cargar los datos. Revisá Internet y volvé a ingresar.', true);
            }));
        });
    }
    function stopSync() {
        session++; stops.forEach(stop=>stop()); stops=[]; ready=false;
        quotes=[]; clients=[]; products=[]; draft=null; dirty=false; productEditId=null;
        if ($('pq-editor')) { $('pq-editor').hidden=true; renderList(); renderProducts(); clearProduct(); renderOptions(); }
    }
    function allowed() {
        if (localPreviewActive) return true;
        if (!canUseCloud() || !ready) { msg('Esperá la carga de datos. Si faltan permisos, publicá las reglas Firestore v19.', true); return false; }
        return true;
    }
    function newDraft(record = null, duplicate = false) {
        if (!allowed() || !canLeave()) return;
        if (record?.saleId && !duplicate) { msg('Este presupuesto ya tiene pedido. Editá el trabajo desde Ventas o duplicá el presupuesto para un nuevo acuerdo.'); return; }
        draft = record ? copy(record) : {
            id:createRecordId('quote'), clientId:'', customer:{name:'',phone:'',email:'',address:''},
            date:today(), validUntil:today(7), status:'Borrador', items:[], discount:0, delivery:0, deposit:0,
            payment:'', deadline:'', contact:publicSettings.whatsapp || '', notes:'', revision:0
        };
        if (duplicate) { draft.id=createRecordId('quote'); delete draft.number; delete draft.createdAt; delete draft.saleId; delete draft.convertedAt; draft.revision=0; draft.date=today(); draft.validUntil=today(7); draft.status='Borrador'; draft.deposit=0; }
        $('pq-number').textContent=draft.number || 'Número automático al guardar';
        const fields = {date:'pq-date', validUntil:'pq-valid',status:'pq-state',discount:'pq-discount',delivery:'pq-delivery',deposit:'pq-deposit',payment:'pq-payment',deadline:'pq-deadline',contact:'pq-contact',notes:'pq-notes'};
        Object.entries(fields).forEach(([key,id])=>$(id).value=draft[key] ?? '');
        ['name','phone','email','address'].forEach(key=>$('pq-'+key).value=draft.customer[key] || '');
        renderOptions(); $('pq-client').value=draft.clientId || '';
        $('pq-editor').hidden=false; dirty=duplicate;
        $('pq-save-status').textContent=draft.number ? 'Editando un presupuesto guardado. Sus precios están fijos.' : 'El número definitivo se asigna al guardar.';
        drawItems(); preview();
        $('pq-editor').scrollIntoView({behavior:'smooth',block:'start'});
    }
    function selectClient() {
        if (!draft) return;
        const client = clients.find(c=>c.id === $('pq-client').value);
        draft.clientId = client?.id || '';
        ['name','phone','email','address'].forEach(key=>$('pq-'+key).value=client?.[key] || '');
        dirty=true;
    }
    function collect(strict = false) {
        const record=copy(draft);
        const fields={date:'pq-date',validUntil:'pq-valid',status:'pq-state',payment:'pq-payment',deadline:'pq-deadline',contact:'pq-contact',notes:'pq-notes'};
        Object.entries(fields).forEach(([key,id])=>record[key]=$(id).value.trim());
        record.clientId=$('pq-client').value || record.clientId;
        record.customer={}; ['name','phone','email','address'].forEach(key=>record.customer[key]=$('pq-'+key).value.trim());
        ['discount','delivery','deposit'].forEach(key=>record[key]=strict ? number($('pq-'+key).value,key==='discount'?'Descuento':key==='delivery'?'Envío':'Seña',0,key==='discount'?100:numericLimit) : Number($('pq-'+key).value)||0);
        record.items=record.items.map((row,index)=> {
            const description=$('pq-desc-'+index).value.trim();
            const qtyValue=$('pq-qty-'+index).value;
            const qty=strict?number(qtyValue,'Cantidad',1,100000):Number(qtyValue)||0;
            const unitPrice=strict?number($('pq-price-'+index).value,'Precio unitario'):Number($('pq-price-'+index).value)||0;
            if(strict && (!description || description.length>500 || !Number.isInteger(Number(qtyValue)))) throw Error('Cada renglón necesita descripción y una cantidad entera positiva.');
            return {...row,description,qty,unitPrice};
        });
        Object.assign(record,totals(record));
        if(strict) {
            if(!record.customer.name || record.customer.name.length>200) throw Error('Ingresá el nombre del cliente.');
            if(!validPhone(record.customer.phone)) throw Error('Ingresá el celular con código de país (10 a 15 dígitos).');
            if(!/^\d{4}-\d{2}-\d{2}$/.test(record.date) || !/^\d{4}-\d{2}-\d{2}$/.test(record.validUntil) || record.validUntil<record.date) throw Error('Revisá la fecha y el vencimiento.');
            if(!record.items.length || record.items.length>100) throw Error('Agregá entre 1 y 100 productos.');
            if(!states.includes(record.status)) throw Error('Estado no válido.');
            if(record.total>numericLimit || record.deposit>record.total) throw Error('La seña no puede superar el total y el total no puede superar $1.000.000.000.');
        }
        return record;
    }
    function preview() {
        if(!draft) return;
        const value=collect();
        $('pq-subtotal').textContent=money(value.subtotal); $('pq-discount-total').textContent=money(value.discountAmount);
        $('pq-total').textContent=money(value.total); $('pq-balance').textContent=money(value.balance);
        value.items.forEach((row,index)=>$('pq-row-total-'+index).textContent=money(round(row.qty*row.unitPrice)));
    }
    function drawItems() {
        $('pq-items').innerHTML=draft.items.map((row,index)=>`<div class="pq-line">
            <label class="pq-field pq-description">Descripción<small>${row.type==='book'?'Libro del catálogo':row.type==='product'?'Producto guardado':'Concepto libre'}</small><input id="pq-desc-${index}" maxlength="500" required value="${esc(row.description)}"></label>
            <label class="pq-field">Cantidad<input id="pq-qty-${index}" type="number" min="1" max="100000" step="1" required value="${esc(row.qty)}"></label>
            <label class="pq-field">Unitario ($)<input id="pq-price-${index}" type="number" min="0" max="1000000000" step="0.01" required value="${esc(row.unitPrice)}"></label>
            <div id="pq-row-total-${index}" class="pq-line-total"></div><button type="button" class="pq-button danger" data-action="remove-row" data-index="${index}" aria-label="Quitar renglón">×</button></div>`).join('');
    }
    function costReady() {
        if(!localPreviewActive && (!masterConfigLoaded || !catalogReadyForPublicSync || Object.keys(costEdits).length || costSaveRunning)) {
            msg('Esperá a que los Costos Base y el catálogo estén cargados y guardados para tomar el precio actual.',true); return false;
        }
        return true;
    }
    function add(type) {
        if(!draft || busy) return;
        if(draft.items.length>=100) { msg('Máximo 100 renglones.',true); return; }
        draft=collect(); let row={type:'free',sourceId:'',description:'',qty:1,unitPrice:0};
        if(type==='book') {
            const book=catalog.find(b=>b.id===$('pq-book').value);
            if(!book) { msg('Elegí un libro.',true); return; }
            if(!costReady()) return;
            row={type,sourceId:book.id,description:book.title,qty:1,unitPrice:round(calculateCatalogBookMetrics(book).finalSalePrice)};
        } else if(type==='product') {
            const product=products.find(p=>p.id===$('pq-product').value);
            if(!product) { msg('Elegí un producto.',true); return; }
            row={type,sourceId:product.id,description:(product.name+(product.description?' - '+product.description:'')).slice(0,500),qty:1,unitPrice:product.unitPrice};
        }
        draft.items.push(row); dirty=true; drawItems(); preview();
    }
    function refreshPrices() {
        if(!draft || !costReady()) return;
        if(!confirm('¿Reemplazar los precios de libros y productos por los actuales? Las cantidades y conceptos libres se conservan.')) return;
        draft=collect(); let missing=0;
        draft.items.forEach(row=> {
            if(row.type==='book') { const book=catalog.find(b=>b.id===row.sourceId); if(book) row.unitPrice=round(calculateCatalogBookMetrics(book).finalSalePrice); else missing++; }
            if(row.type==='product') { const product=products.find(p=>p.id===row.sourceId); if(product) row.unitPrice=product.unitPrice; else missing++; }
        });
        dirty=true; drawItems(); preview(); msg('Precios actualizados en el editor. Guardá para confirmar.'+(missing?' Algunos productos ya no existen y conservaron su precio.':''));
    }
    function setBusy(value) {
        busy=value;
        $('tab-budgets').querySelectorAll('button').forEach(button=>button.disabled=value);
        $('pq-editor').querySelectorAll('input,select,textarea').forEach(input=>input.disabled=value);
        $('pq-save').textContent=value?'Guardando…':'Guardar presupuesto';
    }
    async function save(event) {
        event.preventDefault(); if(busy || !allowed()) return;
        let record;
        try { record=collect(true); } catch(error) { msg(error.message,true); return; }
        record.clientId=record.clientId || createRecordId('client');
        // Keep IDs stable across retries (including a commit whose response was lost).
        draft.clientId=record.clientId;
        const currentSession=session, uid=auth?.currentUser?.uid;
        const local=localPreviewActive;
        setBusy(true); msg('Guardando presupuesto y cliente…');
        let warning=setTimeout(()=>msg('La nube está demorando. No cierres la app mientras se confirma el guardado.'),12000);
        try {
            let saved;
            if(!local) {
                saved=await db.runTransaction(async transaction=> {
                    if(currentSession!==session || auth?.currentUser?.uid!==uid) throw Error('La sesión cambió. Volvé a ingresar.');
                    const ref=db.collection('quotes').doc(record.id);
                    const current=await transaction.get(ref);
                    if (current.exists && current.data().saleId) throw Error('Este presupuesto ya fue convertido en pedido. Editá el pedido desde Ventas.');
                    // Existing quote updates are optimistic: never silently overwrite another device.
                    if(current.exists && Number(current.data().revision || 0)!==Number(record.revision || 0)) throw Error('Otro dispositivo modificó este presupuesto. Cerrá el editor y volvé a abrirlo antes de guardar.');
                    if(!current.exists && record.number) throw Error('Este presupuesto ya no existe en la nube. Duplicalo como uno nuevo.');
                    let result={...record,updatedAt:new Date().toISOString(),revision:Number(record.revision || 0)+1};
                    if(!current.exists) {
                        const year=today().slice(0,4), counterRef=db.collection('quoteCounters').doc(year);
                        const counter=await transaction.get(counterRef);
                        const last=counter.exists ? counter.data().last : 0;
                        if(!Number.isSafeInteger(last) || last<0 || last>=999999999) throw Error('El contador de presupuestos no es válido.');
                        result.number=`PRE-${year}-${String(last+1).padStart(4,'0')}`;
                        result.createdAt=result.updatedAt;
                        transaction.set(counterRef,{last:last+1,updatedAt:result.updatedAt});
                    } else { result.number=current.data().number; result.createdAt=current.data().createdAt; }
                    transaction.set(db.collection('clients').doc(result.clientId),{...result.customer,updatedAt:result.updatedAt});
                    transaction.set(ref,result);
                    return result;
                });
            } else {
                saved={...record,number:record.number || `PRUEBA-${String(quotes.length+1).padStart(4,'0')}`,revision:Number(record.revision||0)+1,createdAt:record.createdAt || new Date().toISOString(),updatedAt:new Date().toISOString()};
            }
            if(currentSession!==session) return;
            const client={...saved.customer,id:saved.clientId}; clients=clients.filter(c=>c.id!==client.id); clients.push(client);
            quotes=quotes.filter(q=>q.id!==saved.id); quotes.push(saved); draft=copy(saved); dirty=false;
            $('pq-number').textContent=saved.number; $('pq-client').value=saved.clientId;
            $('pq-save-status').textContent=local?'Guardado temporal en modo prueba.':'Guardado en la nube. Podés descargar PDF o abrir WhatsApp desde la lista.';
            renderOptions(); $('pq-client').value=saved.clientId; renderList(); msg(local?'Presupuesto de prueba guardado. Al recargar se pierde.':`${saved.number} guardado en la nube.`);
        } catch(error) {
            msg(error.code==='permission-denied'?'No se guardó: publicá las reglas Firestore v19.':`No se guardó: ${error.message}`,true);
        } finally { clearTimeout(warning); setBusy(false); }
    }
    function renderList() {
        const query=($('pq-search')?.value||'').toLocaleLowerCase('es');
        const list=[...quotes].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).filter(q=>`${q.number} ${q.customer.name} ${q.customer.phone} ${q.items.map(i=>i.description).join(' ')}`.toLocaleLowerCase('es').includes(query));
        $('pq-list').innerHTML=list.length ? list.map(q=> {
            const actions=[...(q.saleId?[]:[['edit','Editar']]),['duplicate','Duplicar'],['pdf','Descargar PDF'],['whatsapp','WhatsApp']];
            if(q.saleId || q.status==='Aceptado') actions.push(['convert',q.saleId?'Ver pedido en Ventas':'Convertir en pedido']);
            return `<article class="pq-record"><div><strong>${esc(q.number)}</strong><span class="pq-status">${esc(status(q))}</span><p style="margin-top:7px">${esc(q.customer.name)}</p><p class="pq-muted">${esc(q.customer.phone)} · ${esc(dateLabel(q.date))} · ${q.items.length} producto(s)</p>${q.saleId?'<p class="pq-muted">Pedido creado · Acuerdo conservado sin cambios</p>':''}<p class="amount" style="margin-top:7px">${money(q.total)}</p></div><div class="pq-actions">${actions.map(([action,label])=>`<button type="button" class="pq-button" data-action="${action}" data-id="${esc(q.id)}">${label}</button>`).join('')}</div></article>`;
        }).join('') : '<p class="pq-muted">No hay presupuestos para mostrar.</p>';
    }
    async function convert(record) {
        if(!allowed() || busy || productBusy) return;
        if(dirty) { msg('Guardá o cerrá el presupuesto que estás editando antes de convertir otro.',true); return; }
        if(!window.INPERUOrders) { msg('Falta cargar pedidos.js. Revisá que hayas subido public completo.',true); return; }
        if(!record.saleId && record.status!=='Aceptado') { msg('Primero marcá el presupuesto como Aceptado y guardalo.',true); return; }
        if(!record.saleId && !confirm(`¿Crear en Ventas el pedido de ${record.number} por ${money(record.total)}? Se mantendrán todos los productos, precios y seña. Entrará como Pendiente. El presupuesto quedará como referencia y el trabajo se editará desde Ventas.`)) return;
        const local=localPreviewActive, currentSession=session, uid=auth?.currentUser?.uid;
        setBusy(true); msg('Verificando presupuesto y creando pedido…');
        let result=null;
        const warning=setTimeout(()=>msg('La nube está demorando. Esperá la confirmación; no vuelvas a crear el pedido.'),12000);
        try {
            if(local) {
                const fresh=quotes.find(q=>q.id===record.id);
                if(!fresh) throw Error('El presupuesto ya no existe.');
                const saleId=fresh.saleId || `order-from-${fresh.id}`;
                const existing=sales.find(s=>s.id===saleId);
                if(fresh.saleId && !existing) throw Error('El pedido vinculado no se encuentra. No se creará otro para evitar duplicados.');
                if(existing) result={quote:fresh,order:existing,created:false};
                else {
                    const now=new Date().toISOString();
                    const order=window.INPERUOrders.buildFromQuote(fresh,saleId,now);
                    result={quote:{...fresh,saleId,convertedAt:now,updatedAt:now,revision:Number(fresh.revision)+1},order,created:true};
                }
            } else result=await db.runTransaction(async transaction=> {
                if(currentSession!==session || auth?.currentUser?.uid!==uid) throw Error('La sesión cambió. Volvé a ingresar.');
                const quoteRef=db.collection('quotes').doc(record.id), quoteDoc=await transaction.get(quoteRef);
                if(!quoteDoc.exists) throw Error('El presupuesto ya no existe.');
                const fresh={...quoteDoc.data(),id:record.id};
                const saleId=fresh.saleId || `order-from-${fresh.id}`, saleRef=db.collection('sales').doc(saleId);
                const saleDoc=await transaction.get(saleRef);
                if(fresh.saleId) {
                    if(!saleDoc.exists || saleDoc.data().quoteId!==fresh.id || saleDoc.data().kind!=='quote-order') throw Error('El pedido vinculado no se encuentra o no coincide. No se creará otro.');
                    return {quote:fresh,order:{...saleDoc.data(),id:saleId},created:false};
                }
                if(saleDoc.exists) throw Error('Ya existe un pedido con esta referencia. Revisá Ventas antes de continuar.');
                if(Number(fresh.revision)!==Number(record.revision)) throw Error('Otro dispositivo modificó el presupuesto. Volvé a cargarlo y revisalo antes de convertir.');
                const now=new Date().toISOString(), order=window.INPERUOrders.buildFromQuote(fresh,saleId,now);
                const linked={...fresh,saleId,convertedAt:now,updatedAt:now,revision:Number(fresh.revision)+1};
                transaction.set(saleRef,order); transaction.set(quoteRef,linked);
                return {quote:linked,order,created:true};
            });
            if(currentSession!==session) { result=null; return; }
            quotes=quotes.filter(q=>q.id!==record.id); quotes.push(result.quote);
            window.INPERUOrders.publish(result.order);
            if(draft?.id===record.id) { draft=null; dirty=false; $('pq-editor').hidden=true; }
            renderList();
        } catch(error) {
            result=null; msg(error.code==='permission-denied'?'No se convirtió: publicá las reglas Firestore v20.':`No se convirtió: ${error.message}`,true);
        } finally { clearTimeout(warning); setBusy(false); }
        if(result) { switchTab('sales'); showToastMessage(result.created?'Pedido creado en Ventas. El presupuesto se conserva.':'Este presupuesto ya tenía pedido. No se creó otro.'); }
    }
    function renderProducts() {
        $('pq-products').innerHTML=products.map(p=>`<div class="pq-record"><div><strong>${esc(p.name)}</strong><p class="pq-muted">${esc(p.description)}</p><span class="amount">${money(p.unitPrice)}</span></div><button class="pq-button" type="button" data-action="product-edit" data-id="${esc(p.id)}">Editar</button></div>`).join('');
    }
    function clearProduct() {
        productEditId=null; productEditUpdatedAt=null; $('pq-product-form').reset(); $('pq-product-save').textContent='Guardar producto';
    }
    async function saveProduct(event) {
        event.preventDefault(); if(busy || productBusy || !allowed()) return;
        const product={id:productEditId || createRecordId('product'),name:$('pq-product-name').value.trim(),description:$('pq-product-description').value.trim(),updatedAt:new Date().toISOString()};
        try { product.unitPrice=number($('pq-product-price').value,'Precio'); if(!product.name) throw Error('Ingresá el nombre del producto.'); } catch(error) { msg(error.message,true); return; }
        productBusy=true; $('pq-product-form').querySelectorAll('input,button').forEach(c=>c.disabled=true);
        const currentSession=session, uid=auth?.currentUser?.uid, local=localPreviewActive;
        const previousUpdatedAt=productEditUpdatedAt;
        try {
            if(!local) await db.runTransaction(async transaction=> {
                if(currentSession!==session || auth?.currentUser?.uid!==uid) throw Error('La sesión cambió.');
                const ref=db.collection('products').doc(product.id), snapshot=await transaction.get(ref);
                if(previousUpdatedAt && (!snapshot.exists || snapshot.data().updatedAt!==previousUpdatedAt)) throw Error('Otro dispositivo modificó este producto. Volvé a abrirlo.');
                transaction.set(ref,product);
            });
            if(currentSession!==session) return;
            products=products.filter(p=>p.id!==product.id); products.push(product);
            clearProduct(); renderProducts(); renderOptions(); msg(localPreviewActive?'Producto guardado solo para prueba.':'Producto guardado. No cambia precios de presupuestos anteriores.');
        } catch(error) { msg(`No se guardó el producto: ${error.message}. Revisá conexión y reglas v19.`,true); productEditId=product.id; }
        finally { productBusy=false; $('pq-product-form').querySelectorAll('input,button').forEach(c=>c.disabled=false); }
    }
    function whatsapp(record) {
        if(dirty && draft?.id===record.id) { msg('Guardá los cambios antes de enviar los datos actualizados por WhatsApp.',true); return; }
        if(!validPhone(record.customer.phone)) { msg('Revisá el celular con código de país antes de abrir WhatsApp.',true); return; }
        const text=`Hola ${record.customer.name}, te enviamos el presupuesto ${record.number} de INPERU Producciones. Total: ${money(record.total)} ARS. Válido hasta ${dateLabel(record.validUntil)}. Te adjuntamos el PDF con el detalle.`;
        window.open(`https://wa.me/${phoneDigits(record.customer.phone)}?text=${encodeURIComponent(text)}`,'_blank','noopener,noreferrer');
        msg('WhatsApp abierto con el mensaje. Descargá el PDF y adjuntalo manualmente. El estado no cambia hasta que lo edites.');
    }
    function handleClick(event) {
        const button=event.target.closest('[data-action]'); if(!button || busy || productBusy) return;
        const action=button.dataset.action, record=quotes.find(q=>q.id===button.dataset.id);
        if(action==='new') newDraft();
        else if(action==='close') { if(canLeave()) { draft=null; $('pq-editor').hidden=true; } }
        else if(action==='manager') { $('pq-manager').hidden=!$('pq-manager').hidden; renderProducts(); }
        else if(action==='edit' && record) newDraft(record);
        else if(action==='duplicate' && record) newDraft(record,true);
        else if(action==='add-book') add('book');
        else if(action==='add-product') add('product');
        else if(action==='add-free') add('free');
        else if(action==='refresh-prices') refreshPrices();
        else if(action==='remove-row' && draft) { draft=collect(); draft.items.splice(Number(button.dataset.index),1); dirty=true; drawItems(); preview(); }
        else if(action==='pdf' && record) downloadPdf(record);
        else if(action==='whatsapp' && record) whatsapp(record);
        else if(action==='convert' && record) convert(record);
        else if(action==='product-cancel') clearProduct();
        else if(action==='product-edit') {
            const product=products.find(p=>p.id===button.dataset.id); if(!product) return;
            productEditId=product.id; productEditUpdatedAt=product.updatedAt; $('pq-product-name').value=product.name; $('pq-product-price').value=product.unitPrice; $('pq-product-description').value=product.description || ''; $('pq-product-save').textContent='Guardar cambios';
        }
    }
    async function createPdf(record) {
        if(!window.jspdf?.jsPDF) throw Error('No se cargó el generador PDF. Revisá que hayas subido la carpeta vendor.');
        const doc=new window.jspdf.jsPDF({unit:'mm',format:'a4',compress:true});
        const left=18, right=192, width=174;
        let y=18;
        doc.setProperties({title:`Presupuesto ${record.number} - INPERU Producciones`,author:'INPERU Producciones'});
        const text=(value,x,at,size=10,color=[35,50,57],bold=false)=> { doc.setFont('helvetica',bold?'bold':'normal'); doc.setFontSize(size); doc.setTextColor(...color); doc.text(String(value),x,at); };
        function header(continued=false) {
            doc.setFillColor(9,33,39); doc.rect(0,0,210,40,'F');
            text('INPERU',left,17,21,[74,226,235],true); text('PRODUCCIONES',left,24,9,[220,248,250],true);
            text('PRESUPUESTO',133,15,12,[255,255,255],true); text(record.number,133,24,12,[74,226,235],true);
            text(continued?'Detalle (continuación)':'Documento comercial · Moneda: ARS',left,33,8,[220,248,250]);
            y=50;
        }
        function space(height) { if(y+height>274) { doc.addPage(); header(true); } }
        function paragraph(value,size=10) {
            doc.setFont('helvetica','normal'); doc.setFontSize(size);
            const lines=doc.splitTextToSize(String(value || '').replace(/\r/g,''),width);
            lines.forEach(line=> { space(5); text(line,left,y,size); y+=5; });
            y+=3;
        }
        header();
        try {
            const image=await new Promise((resolve,reject)=> { const img=new Image(); img.onload=()=>resolve(img); img.onerror=reject; img.src='./icons/neon-icon-192.png'; });
            doc.addImage(image,'PNG',91,8,25,25);
        } catch(error) { /* Text brand remains visible if the icon is unavailable. */ }
        text(`Fecha: ${dateLabel(record.date)}`,left,y,10); text(`Válido hasta: ${dateLabel(record.validUntil)}`,117,y,10); y+=9;
        text('CLIENTE',left,y,9,[31,111,120],true); y+=6;
        paragraph(record.customer.name,12); paragraph(`Celular: ${record.customer.phone}`);
        if(record.customer.email) paragraph(`Email: ${record.customer.email}`);
        if(record.customer.address) paragraph(`Dirección: ${record.customer.address}`);
        if(record.contact) paragraph(`Contacto INPERU: ${record.contact}`);
        const tableHeader=()=> { space(13); doc.setFillColor(230,243,244); doc.rect(left,y-5,width,10,'F'); text('PRODUCTO / SERVICIO',20,y,9,[31,111,120],true); text('CANT.',120,y,9,[31,111,120],true); text('UNITARIO',140,y,9,[31,111,120],true); text('IMPORTE',170,y,9,[31,111,120],true); y+=12; };
        tableHeader();
        record.items.forEach(row=> {
            doc.setFontSize(9); doc.setFont('helvetica','normal');
            const lines=doc.splitTextToSize(row.description,94);
            // Descriptions up to 500 chars can span a page; split safely instead of clipping.
            let pos=0, first=true;
            while(pos<lines.length) {
                if(y+10>274) { doc.addPage(); header(true); tableHeader(); }
                const count=Math.max(1,Math.min(lines.length-pos,Math.floor((271-y)/4.5)));
                lines.slice(pos,pos+count).forEach((line,i)=>text(line,20,y+i*4.5,9));
                if(first) {
                    text(String(row.qty),123,y,9);
                    doc.setFontSize(9); doc.setTextColor(35,50,57); doc.text(money(row.unitPrice),164,y,{align:'right'}); doc.text(money(round(row.qty*row.unitPrice)),190,y,{align:'right'});
                    first=false;
                }
                y+=count*4.5; pos+=count;
                if(pos<lines.length) { doc.addPage(); header(true); tableHeader(); }
            }
            y+=5; doc.setDrawColor(221,233,235); doc.line(left,y-2,right,y-2); y+=3;
        });
        space(47); y+=3;
        const summary=(label,value,bold=false)=> { text(label,110,y,bold?12:10,[31,111,120],bold); doc.setFontSize(bold?12:10); doc.text(money(value),right,y,{align:'right'}); y+=7; };
        summary('Subtotal',record.subtotal); summary(`Descuento (${record.discount}%)`,-record.discountAmount); summary('Entrega / envío',record.delivery); summary('TOTAL ARS',record.total,true);
        if(record.deposit) { summary('Seña / anticipo',record.deposit); summary('Saldo',record.balance,true); }
        y+=8; space(18); text('CONDICIONES',left,y,9,[31,111,120],true); y+=7;
        if(record.payment) paragraph(`Forma de pago: ${record.payment}`);
        if(record.deadline) paragraph(`Plazo de entrega: ${record.deadline}`);
        if(record.notes) paragraph(record.notes);
        paragraph('Este presupuesto no constituye una factura. Precios válidos hasta la fecha indicada.',8);
        const pages=doc.getNumberOfPages();
        for(let i=1;i<=pages;i++) { doc.setPage(i); doc.setDrawColor(221,233,235); doc.line(left,283,right,283); text('INPERU Producciones',left,289,8,[85,110,118]); text(`${record.number}  |  ${i} / ${pages}`,130,289,8,[85,110,118]); }
        return doc;
    }
    async function downloadPdf(record) {
        try {
            if(dirty && draft?.id===record.id) { msg('Guardá los cambios antes de descargar el PDF actualizado.',true); return; }
            const pdf=await createPdf(record); pdf.save(`INPERU-${record.number}.pdf`); msg('PDF descargado. Podés adjuntarlo al chat de WhatsApp.');
        } catch(error) { msg(error.message,true); }
    }
    mount();
    window.INPERUQuotes={render,renderOptions,startSync,stopSync,canLeave,createPdf};
    if(canUseCloud()) startSync();
    window.addEventListener('beforeunload',event=> { if(dirty || busy || productBusy) { event.preventDefault(); event.returnValue=''; } });
})();
