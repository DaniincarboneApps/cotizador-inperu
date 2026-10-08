/* Pedidos multiproducto derivados de un presupuesto. Las ventas anteriores siguen intactas. */
(() => {
    'use strict';
    const $=id=>document.getElementById(id), esc=escapeHtml, money=formatMoney;
    const copy=value=>JSON.parse(JSON.stringify(value));
    const statuses=['Pendiente','Pagado sin entregar','Finalizado','Anulado'];
    const round=value=>Math.round((value+Number.EPSILON)*100)/100;
    let editing=null, dirty=false, busy=false, session=0, returnFocus=null;
    const isOrder=record=>record?.kind==='quote-order';
    const stamp=()=>new Date().toISOString();
    const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
    function numeric(value,label,min=0,max=1000000000,integer=false) {
        const n=Number(value);
        if(String(value).trim()==='' || !Number.isFinite(n) || n<min || n>max || (integer && !Number.isInteger(n))) throw Error(`Revisá ${label}.`);
        return integer?n:round(n);
    }
    function totals(record) {
        const subtotal=round(record.items.reduce((sum,row)=>sum+round(row.qty*row.unitPrice),0));
        const discountAmount=round(subtotal*record.discount/100), total=round(subtotal-discountAmount+record.delivery);
        return {subtotal,discountAmount,total,balance:round(total-record.deposit),qty:record.items.reduce((sum,row)=>sum+row.qty,0)};
    }
    function validate(record) {
        if(!record.customer?.trim() || record.customer.length>200) throw Error('Ingresá un cliente válido.');
        if(!/^[0-9]{10,15}$/.test(String(record.phone).replace(/\D/g,''))) throw Error('Ingresá el celular con código de país.');
        if(!Array.isArray(record.items) || !record.items.length || record.items.length>100) throw Error('El pedido necesita entre 1 y 100 productos.');
        record.items.forEach(row=> {
            if(typeof row.description!=='string' || !row.description.trim() || row.description.length>500) throw Error('Revisá la descripción de los productos.');
            numeric(row.qty,'la cantidad',1,100000,true); numeric(row.unitPrice,'el precio unitario');
        });
        numeric(record.discount,'el descuento',0,100); numeric(record.delivery,'el envío'); numeric(record.deposit,'la seña');
        const result=totals(record);
        if(result.total>1000000000 || result.balance<0) throw Error('La seña no puede superar el total y el total máximo es $1.000.000.000.');
        if(!statuses.includes(record.status)) throw Error('Estado no válido.');
        if(!/^\d{4}-\d{2}-\d{2}$/.test(record.date)) throw Error('Revisá la fecha.');
        if(String(record.notes).length>3000 || String(record.payment).length>200 || String(record.deadline).length>200 || String(record.contact).length>200) throw Error('Los textos exceden el largo permitido.');
        return result;
    }
    function buildFromQuote(quote,id,now=stamp()) {
        if(quote.status!=='Aceptado') throw Error('El presupuesto debe estar Aceptado.');
        const order={
            id,kind:'quote-order',quoteId:quote.id,quoteNumber:quote.number,clientId:quote.clientId,
            customer:quote.customer.name,phone:quote.customer.phone,customerDetails:copy(quote.customer),
            date:today(),bookId:null,bookTitle:`Pedido ${quote.number}`,unitPrice:0,
            items:copy(quote.items),discount:quote.discount,delivery:quote.delivery,deposit:quote.deposit,
            payment:quote.payment,deadline:quote.deadline,contact:quote.contact,notes:quote.notes,
            status:'Pendiente',createdAt:now,updatedAt:now,revision:1
        };
        const computed=validate(order);
        for(const key of ['subtotal','discountAmount','total','balance']) {
            if(!Number.isFinite(Number(quote[key])) || round(Number(quote[key]))!==computed[key]) throw Error('Los totales guardados del presupuesto no coinciden con su detalle. Revisalo antes de convertir.');
        }
        return {...order,...computed};
    }
    function publish(record) {
        sales=sales.filter(sale=>sale.id!==record.id); sales.unshift(copy(record)); renderSales();
    }
    function renderCard(order) {
        const color=order.status==='Finalizado'?'#34d399':order.status==='Anulado'?'#fda4af':order.status==='Pagado sin entregar'?'#5eead4':'#fcd34d';
        const rowAction=(action,label)=>`<button type="button" class="pq-button" data-order-action="${action}" data-id="${esc(order.id)}">${label}</button>`;
        return `<article class="pq-card order-card" data-order-id="${esc(order.id)}">
            <div class="pq-heading" style="margin-bottom:10px"><div><strong>${esc(order.customer)}</strong><span class="pq-status" style="color:${color}">${esc(order.status)}</span><p class="pq-muted">Presupuesto ${esc(order.quoteNumber)} · ${esc(order.date)}</p><div class="pq-actions" style="margin-top:8px"><span class="pq-muted">${esc(order.phone)}</span>${order.phone?rowAction('whatsapp','WhatsApp · Pedido listo'):''}</div></div>
            <div><strong style="font-size:22px;color:#34d399">${money(order.total)}</strong><p class="pq-muted">Seña: ${money(order.deposit)} · Saldo: ${money(order.balance)}</p></div></div>
            <details class="order-detail"><summary>${order.items.length} producto(s) · ${esc(order.qty)} unidades · Ver detalle</summary><ul>${order.items.map(row=>`<li><span>${esc(row.description)}</span><span>${esc(row.qty)} × ${money(row.unitPrice)} = ${money(round(row.qty*row.unitPrice))}</span></li>`).join('')}</ul>
            <p class="pq-muted">Subtotal: ${money(order.subtotal)} · Descuento ${order.discount}%: ${money(order.discountAmount)} · Entrega: ${money(order.delivery)}</p>
            ${order.payment?`<p class="pq-muted">Pago: ${esc(order.payment)}</p>`:''}${order.deadline?`<p class="pq-muted">Entrega: ${esc(order.deadline)}</p>`:''}
            ${order.notes?`<p class="pq-muted" style="white-space:pre-wrap">${esc(order.notes)}</p>`:''}</details>
            <div class="pq-actions" style="margin-top:14px"><label class="pq-field">Estado<select data-order-status="${esc(order.id)}">${statuses.map(s=>`<option ${s===order.status?'selected':''}>${esc(s)}</option>`).join('')}</select></label>${rowAction('edit','Editar pedido')}${order.status!=='Anulado'?rowAction('cancel','Anular pedido'):''}<span class="pq-muted">El acuerdo original se conserva en Presupuestos.</span></div>
        </article>`;
    }
    function mount() {
        const modal=document.createElement('div'); modal.id='order-modal'; modal.hidden=true;
        modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true'); modal.setAttribute('aria-labelledby','po-title');
        modal.innerHTML=`<form id="po-form" class="order-sheet"><div class="pq-heading"><div><h2 id="po-title">Editar pedido</h2><p class="pq-muted">Los cambios afectan este pedido, no el presupuesto aceptado.</p></div><button type="button" class="pq-button" id="po-close">Cerrar</button></div><div id="po-notice" class="pq-notice" role="status"></div>
            <div class="pq-grid"><label class="pq-field">Cliente<input id="po-customer" maxlength="200" required></label><label class="pq-field">Celular con código de país<input id="po-phone" type="tel" maxlength="30" required></label><label class="pq-field">Fecha<input id="po-date" type="date" required></label><label class="pq-field">Estado<select id="po-status">${statuses.map(s=>`<option>${s}</option>`).join('')}</select></label></div>
            <div class="pq-card" style="margin-top:18px"><h3>Detalle del pedido</h3><div id="po-items" class="pq-items"></div></div>
            <div class="pq-grid three"><label class="pq-field">Descuento (%)<input id="po-discount" type="number" min="0" max="100" step="0.01" required></label><label class="pq-field">Entrega / envío ($)<input id="po-delivery" type="number" min="0" max="1000000000" step="0.01" required></label><label class="pq-field">Seña / anticipo ($)<input id="po-deposit" type="number" min="0" max="1000000000" step="0.01" required></label><label class="pq-field">Forma de pago<input id="po-payment" maxlength="200"></label><label class="pq-field">Plazo de entrega<input id="po-deadline" maxlength="200"></label><label class="pq-field">Contacto INPERU<input id="po-contact" maxlength="200"></label><label class="pq-field pq-wide">Observaciones<textarea id="po-notes" maxlength="3000"></textarea></label></div>
            <div class="pq-summary"><div><span>Subtotal</span><span id="po-subtotal"></span></div><div class="total"><span>Total ARS</span><span id="po-total"></span></div><div><span>Saldo tras seña</span><span id="po-balance"></span></div></div>
            <div class="pq-actions" style="margin-top:20px"><button type="submit" id="po-save" class="pq-button primary">Guardar pedido</button><span class="pq-muted">Los precios no se actualizan desde Costos Base.</span></div></form>`;
        document.body.appendChild(modal);
        $('po-form').addEventListener('submit',save);
        $('po-form').addEventListener('input',()=>{dirty=true;preview();});
        $('po-form').addEventListener('change',()=>{dirty=true;preview();});
        $('po-close').addEventListener('click',close);
        $('sales-list').addEventListener('click',event=> {
            const button=event.target.closest('[data-order-action]'); if(!button || busy) return;
            const order=sales.find(s=>s.id===button.dataset.id); if(!isOrder(order)) return;
            const action=button.dataset.orderAction;
            if(action==='edit') edit(order); else if(action==='cancel') cancel(order); else if(action==='whatsapp') whatsapp(order);
        });
        $('sales-list').addEventListener('change',event=> {
            const select=event.target.closest('[data-order-status]'); if(!select) return;
            const order=sales.find(s=>s.id===select.dataset.orderStatus); if(order) updateStatus(order,select.value);
        });
        modal.addEventListener('keydown',event=> {
            if(event.key==='Escape') { event.preventDefault(); close(); }
            if(event.key==='Tab') {
                const controls=[...modal.querySelectorAll('button,input,select,textarea')].filter(c=>!c.disabled);
                const first=controls[0],last=controls.at(-1);
                if(event.shiftKey && document.activeElement===first) { event.preventDefault(); last?.focus(); }
                else if(!event.shiftKey && document.activeElement===last) { event.preventDefault(); first?.focus(); }
            }
        });
    }
    function notice(message,error=false) { $('po-notice').textContent=message; $('po-notice').style.color=error?'#fda4af':'#99f6e4'; }
    function setBusy(value) { busy=value; $('po-form').querySelectorAll('input,select,textarea,button').forEach(c=>c.disabled=value); $('po-save').textContent=value?'Guardando…':'Guardar pedido'; }
    function reset() { session++; editing=null; dirty=false; $('order-modal').hidden=true; }
    function canLeave() {
        if(busy) { showToastMessage('Esperá a que termine de guardar el pedido.'); return false; }
        if(!editing) return true;
        if(dirty && !confirm('Hay cambios del pedido sin guardar. ¿Querés descartarlos?')) return false;
        editing=null; dirty=false; $('order-modal').hidden=true; return true;
    }
    function close() { if(canLeave()) returnFocus?.focus(); }
    function edit(record) {
        if(!canLeave()) return;
        if(!localPreviewActive && !canUseCloud()) { showToastMessage('Ingresá para editar el pedido.'); return; }
        returnFocus=document.activeElement; editing=copy(record); dirty=false;
        $('po-title').textContent=`Pedido de ${record.quoteNumber}`;
        const fields=['customer','phone','date','status','discount','delivery','deposit','payment','deadline','contact','notes'];
        fields.forEach(key=>$('po-'+key).value=record[key] ?? '');
        $('po-items').innerHTML=record.items.map((row,index)=>`<div class="pq-line"><label class="pq-field pq-description">Producto / servicio<input id="po-desc-${index}" maxlength="500" required value="${esc(row.description)}"></label><label class="pq-field">Cantidad<input id="po-qty-${index}" type="number" min="1" max="100000" step="1" required value="${esc(row.qty)}"></label><label class="pq-field">Unitario ($)<input id="po-price-${index}" type="number" min="0" max="1000000000" step="0.01" required value="${esc(row.unitPrice)}"></label><div id="po-row-total-${index}" class="pq-line-total"></div></div>`).join('');
        $('order-modal').hidden=false; notice('Podés editar cantidades y precios del trabajo. Se mantienen fijos hasta que vos los cambies.'); preview(); $('po-form').scrollTop=0; $('po-customer').focus({preventScroll:true});
    }
    function collect(strict=false) {
        const result=copy(editing);
        ['customer','phone','date','status','payment','deadline','contact','notes'].forEach(key=>result[key]=$('po-'+key).value.trim());
        ['discount','delivery','deposit'].forEach(key=>result[key]=strict?numeric($('po-'+key).value,key,0,key==='discount'?100:1000000000):Number($('po-'+key).value)||0);
        result.items=result.items.map((row,i)=>({...row,description:$('po-desc-'+i).value.trim(),qty:strict?numeric($('po-qty-'+i).value,'la cantidad',1,100000,true):Number($('po-qty-'+i).value)||0,unitPrice:strict?numeric($('po-price-'+i).value,'el precio unitario'):Number($('po-price-'+i).value)||0}));
        result.customerDetails={...result.customerDetails,name:result.customer,phone:result.phone};
        Object.assign(result,strict?validate(result):totals(result)); return result;
    }
    function preview() { if(!editing) return; const r=collect(); $('po-subtotal').textContent=money(r.subtotal); $('po-total').textContent=money(r.total); $('po-balance').textContent=money(r.balance); r.items.forEach((row,i)=>$('po-row-total-'+i).textContent=money(round(row.qty*row.unitPrice))); }
    async function commit(record) {
        if(localPreviewActive) {
            const previous=sales.find(s=>s.id===record.id);
            if(!previous || previous.revision!==record.revision) throw Error('El pedido cambió. Volvé a abrirlo.');
            return {...record,revision:record.revision+1,updatedAt:stamp()};
        }
        if(!canUseCloud()) throw Error('Ingresá para guardar el pedido.');
        const currentSession=session, uid=auth.currentUser.uid;
        return db.runTransaction(async transaction=> {
            if(currentSession!==session || auth?.currentUser?.uid!==uid) throw Error('La sesión cambió.');
            const ref=db.collection('sales').doc(record.id), doc=await transaction.get(ref);
            if(!doc.exists || !isOrder(doc.data())) throw Error('El pedido no se encuentra.');
            if(Number(doc.data().revision)!==Number(record.revision)) throw Error('Otro dispositivo modificó este pedido. Cerrá y volvé a abrirlo antes de guardar.');
            const previous=doc.data();
            const result={...record,id:record.id,kind:'quote-order',quoteId:previous.quoteId,quoteNumber:previous.quoteNumber,createdAt:previous.createdAt,updatedAt:stamp(),revision:Number(previous.revision)+1};
            transaction.set(ref,result); return result;
        });
    }
    async function save(event) {
        event.preventDefault(); if(busy || !editing) return;
        let record; try { record=collect(true); } catch(error) { notice(error.message,true); return; }
        if(record.status==='Anulado' && editing.status!=='Anulado' && !confirm('¿Anular el pedido? Se conservará el historial y se excluirá de los totales de Ventas.')) return;
        const currentSession=session; setBusy(true); notice('Guardando pedido…');
        const timer=setTimeout(()=>notice('La nube está demorando. Esperá la confirmación antes de cerrar.'),12000);
        try { const saved=await commit(record); if(currentSession!==session) return; publish(saved); dirty=false; editing=null; $('order-modal').hidden=true; showToastMessage('Pedido guardado. El presupuesto original no cambió.'); }
        catch(error) { notice(error.code==='permission-denied'?'No se guardó: publicá las reglas Firestore v20.':error.message,true); }
        finally { clearTimeout(timer); setBusy(false); }
    }
    async function updateStatus(record,status) {
        if(busy || !statuses.includes(status) || status===record.status) { renderSales(); return; }
        if(status==='Anulado' && !confirm('¿Anular este pedido? No se borrará el presupuesto ni se permitirá duplicar la conversión.')) { renderSales(); return; }
        if(editing) { showToastMessage('Cerrá el editor antes de cambiar el estado desde la lista.'); renderSales(); return; }
        const currentSession=session; setBusy(true);
        try { const saved=await commit({...copy(record),status}); if(currentSession===session) { publish(saved); showToastMessage(status==='Finalizado'?'Pedido entregado / finalizado.':`Pedido: ${status}.`); } }
        catch(error) { renderSales(); showToastMessage(error.code==='permission-denied'?'No se cambió el estado. Publicá las reglas Firestore v20.':error.message); }
        finally { setBusy(false); }
    }
    async function cancel(record) { if(record.status==='Anulado') { showToastMessage('Este pedido ya está anulado.'); return; } await updateStatus(record,'Anulado'); }
    function whatsapp(record) {
        if(record.status==='Anulado') { showToastMessage('El pedido está anulado.'); return; }
        const phone=String(record.phone).replace(/\D/g,''); if(!/^[0-9]{10,15}$/.test(phone)) { showToastMessage('Revisá el celular con código de país.'); return; }
        const message=`Hola ${record.customer}, te avisamos desde INPERU Producciones que tu pedido correspondiente al presupuesto ${record.quoteNumber} ya está listo para retirar. Muchas gracias.`;
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`,'_blank','noopener,noreferrer');
    }
    mount();
    window.INPERUOrders={isOrder,buildFromQuote,publish,renderCard,edit,updateStatus,cancel,whatsapp,canLeave,reset};
    window.addEventListener('beforeunload',event=>{if(dirty || busy){event.preventDefault();event.returnValue='';}});
    renderSales();
})();
