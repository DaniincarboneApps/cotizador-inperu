const firebaseConfig = {
    apiKey: "AIzaSyBMqyAp0dQ3vM0Z7ZZp2p8Htixcjx5HyVo",
    authDomain: "inperu-cotizador.firebaseapp.com",
    projectId: "inperu-cotizador",
    storageBucket: "inperu-cotizador.firebasestorage.app",
    messagingSenderId: "76240882727",
    appId: "1:76240882727:web:6e73ee4f7228b77e789202"
};

const CART_STORAGE_KEY = 'inperu-public-order-v1';
const SHELF_SIZE = 6;
let publicBooks = [];
let publicWhatsapp = '';
let activeBook = null;
let activeFilter = 'featured';
let activeGenre = 'all';
let cart = new Map();
let toastTimer = null;

const shelves = document.getElementById('catalog-shelves');
const statusBox = document.getElementById('catalog-status');
const searchInput = document.getElementById('catalog-search');
const clearSearchButton = document.getElementById('clear-search');
const dialog = document.getElementById('book-dialog');
const drawer = document.getElementById('order-drawer');
const drawerBackdrop = document.getElementById('drawer-backdrop');

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function safeImageSource(value) {
    const source = typeof value === 'string' ? value.trim() : '';
    if (/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(source)) return source;
    if (/^https:\/\//i.test(source)) {
        try {
            const url = new URL(source);
            return url.protocol === 'https:' ? url.href : null;
        } catch (error) {
            return null;
        }
    }
    return null;
}

function formatMoney(value) {
    return Number(value || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}

function normalizeWhatsapp(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    return digits;
}

function formatPrintMode(value) {
    return value === 'simple' ? 'Simple faz' : 'Doble faz';
}

function formatColorMode(value) {
    return value === 'color' ? 'A color' : 'Blanco y negro';
}

function getBook(id) {
    return publicBooks.find(book => book.id === id) || null;
}

function getBookTimestamp(book) {
    if (book.updatedAt && typeof book.updatedAt.toMillis === 'function') return book.updatedAt.toMillis();
    if (book.updatedAt && Number.isFinite(book.updatedAt.seconds)) return book.updatedAt.seconds * 1000;
    return 0;
}

function coverTone(book) {
    const text = String(book.title || book.id || 'INPERU');
    const hash = [...text].reduce((total, char) => total + char.charCodeAt(0), 0);
    return `tone-${hash % 6}`;
}

function coverInitials(book) {
    const words = String(book.title || 'INPERU').trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map(word => word[0]).join('').toLocaleUpperCase('es') || 'IN';
}

function setQuantityInput(value) {
    document.getElementById('detail-quantity').value = Math.max(1, Math.min(999, Number.parseInt(value, 10) || 1));
}

function updateContactLinks() {
    const link = document.getElementById('header-whatsapp');
    if (!publicWhatsapp) {
        link.href = '#';
        link.classList.add('is-disabled');
        link.setAttribute('aria-disabled', 'true');
        return;
    }
    link.href = `https://wa.me/${publicWhatsapp}`;
    link.classList.remove('is-disabled');
    link.removeAttribute('aria-disabled');
    link.target = '_blank';
    link.rel = 'noopener';
}

function coverMarkup(book, className, altPrefix = 'Portada de') {
    const coverSource = safeImageSource(book.coverImage);
    if (coverSource) {
        return `<img class="${escapeHtml(className)}" src="${escapeHtml(coverSource)}" alt="${escapeHtml(`${altPrefix} ${book.title || 'libro'}`.trim())}" loading="lazy" decoding="async">`;
    }
    return `<span class="cover-placeholder ${coverTone(book)}" aria-hidden="true"><b>${escapeHtml(coverInitials(book))}</b><small>INPERU</small></span>`;
}

function renderHeroCover() {
    const target = document.getElementById('hero-featured-cover');
    const featured = publicBooks.filter(book => book.featured === true).sort((a, b) => getBookTimestamp(b) - getBookTimestamp(a))[0];
    target.innerHTML = featured ? coverMarkup(featured, 'hero-cover-image', '') : '<span>CATÁLOGO</span>';
}

function matchesCurrentFilter(book) {
    if (activeFilter === 'featured') return book.featured === true;
    if (activeFilter === 'all') return true;
    if (activeFilter === 'A4' || activeFilter === 'A5') return book.format === activeFilter;
    if (activeFilter === 'color' || activeFilter === 'bw') return book.colorMode === activeFilter;
    return true;
}

function filteredBooks() {
    const query = searchInput.value.trim().toLocaleLowerCase('es');
    return publicBooks.filter(book => {
        const text = `${book.title || ''} ${book.author || ''} ${book.genre || ''} ${book.description || ''} ${book.deliverables || ''}`.toLocaleLowerCase('es');
        const genreMatches = activeGenre === 'all' || book.genre === activeGenre;
        const mainFilterMatches = query && activeFilter === 'featured' ? true : matchesCurrentFilter(book);
        return genreMatches && mainFilterMatches && (!query || text.includes(query));
    });
}

function renderGenreOptions() {
    const select = document.getElementById('genre-filter');
    const genres = [...new Set(publicBooks.map(book => String(book.genre || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    if (activeGenre !== 'all' && !genres.includes(activeGenre)) activeGenre = 'all';
    select.innerHTML = '<option value="all">Todos los géneros</option>'
        + genres.map(genre => `<option value="${escapeHtml(genre)}">${escapeHtml(genre)}</option>`).join('');
    select.value = activeGenre;
}

function bookTileMarkup(book) {
    return `
        <article class="book-tile">
            <button class="book-open" type="button" data-book-id="${escapeHtml(book.id)}" aria-label="Ver ficha completa de ${escapeHtml(book.title)}">
                <span class="tile-cover">${coverMarkup(book, 'book-cover')}</span>
                <span class="tile-info"><h3>${escapeHtml(book.title || 'Libro sin título')}</h3><small>${escapeHtml(book.author || book.genre || 'Biblioteca INPERU')}</small><span>${formatMoney(book.price)}</span></span>
            </button>
            <button class="quick-add" type="button" data-add-id="${escapeHtml(book.id)}" aria-label="Agregar ${escapeHtml(book.title)} al pedido">＋</button>
        </article>`;
}

function renderCatalog() {
    const books = filteredBooks();
    const query = searchInput.value.trim();
    clearSearchButton.hidden = !query;
    document.getElementById('hero-book-count').textContent = publicBooks.length;
    renderHeroCover();

    const searchingAll = Boolean(query) && activeFilter === 'featured';
    const filterNames = { featured: 'selección INPERU', all: 'catálogo completo', bw: 'blanco y negro', color: 'a color', A4: 'A4', A5: 'A5' };
    const filterLabel = searchingAll ? ' · buscando en todo el repositorio' : ` · ${filterNames[activeFilter] || activeFilter}`;
    const genreLabel = activeGenre === 'all' ? '' : ` · ${activeGenre}`;
    statusBox.textContent = `${books.length} título${books.length === 1 ? '' : 's'} encontrado${books.length === 1 ? '' : 's'}${filterLabel}${genreLabel}`;

    if (!books.length) {
        const isEmptySelection = publicBooks.length && !query && activeFilter === 'featured' && activeGenre === 'all';
        shelves.innerHTML = `<div class="empty-state"><strong>${isEmptySelection ? 'La selección está lista para configurar' : publicBooks.length ? 'No encontramos coincidencias' : 'La biblioteca se está preparando'}</strong><span>${isEmptySelection ? 'Marcá como destacados los libros que quieras mostrar al ingresar, o abrí el catálogo completo.' : publicBooks.length ? 'Probá con otra búsqueda, otro género o elegí Ver todo.' : 'Volvé a intentarlo en unos minutos.'}</span>${isEmptySelection ? '<button type="button" class="empty-show-all" data-show-all>Ver catálogo completo</button>' : ''}</div>`;
        return;
    }

    const chunks = [];
    for (let index = 0; index < books.length; index += SHELF_SIZE) chunks.push(books.slice(index, index + SHELF_SIZE));
    shelves.innerHTML = chunks.map((chunk, index) => `
        <section class="shelf" aria-label="Estante ${index + 1}">
            <div class="shelf-label">ESTANTE ${String(index + 1).padStart(2, '0')}</div>
            <div class="shelf-row">${chunk.map(bookTileMarkup).join('')}</div>
        </section>`).join('');
}

function openBook(id) {
    activeBook = getBook(id);
    if (!activeBook) return;
    document.getElementById('detail-cover').innerHTML = coverMarkup(activeBook, 'detail-generated-cover');
    document.getElementById('detail-meta').textContent = `${activeBook.genre || 'BIBLIOTECA INPERU'}${activeBook.author ? ` · ${activeBook.author}` : ''}`;
    document.getElementById('detail-title').textContent = activeBook.title || '';
    document.getElementById('detail-description').textContent = activeBook.description || 'Sin descripción adicional.';
    document.getElementById('detail-delivery').textContent = activeBook.deliverables || 'Consultá las opciones de terminación y entrega.';
    document.getElementById('detail-format').textContent = activeBook.format || 'A5';
    document.getElementById('detail-pages').textContent = Number(activeBook.pages) || 0;
    document.getElementById('detail-print').textContent = formatPrintMode(activeBook.printMode);
    document.getElementById('detail-color').textContent = formatColorMode(activeBook.colorMode);
    document.getElementById('detail-price').textContent = formatMoney(activeBook.price);
    setQuantityInput(1);
    const orderButton = document.getElementById('detail-order');
    orderButton.disabled = !publicWhatsapp;
    document.getElementById('whatsapp-note').textContent = publicWhatsapp ? 'Disponibilidad y entrega se confirman por WhatsApp.' : 'El WhatsApp comercial todavía no fue configurado.';
    dialog.showModal();
}

function openWhatsapp(message) {
    if (!publicWhatsapp) {
        showToast('El WhatsApp comercial todavía no fue configurado.');
        return;
    }
    window.open(`https://wa.me/${publicWhatsapp}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
}

function orderActiveBook() {
    if (!activeBook) return;
    const quantity = Math.max(1, Math.min(999, Number.parseInt(document.getElementById('detail-quantity').value, 10) || 1));
    const total = Number(activeBook.price || 0) * quantity;
    const message = `Hola INPERU, quiero pedir ${quantity} ejemplar${quantity === 1 ? '' : 'es'} del libro “${activeBook.title}”.\n\nPrecio informado: ${formatMoney(activeBook.price)} por unidad.\nTotal estimado: ${formatMoney(total)}.\n\nQuisiera confirmar disponibilidad y forma de entrega.`;
    openWhatsapp(message);
}

function loadCart() {
    try {
        const saved = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]');
        if (Array.isArray(saved)) {
            saved.forEach(item => {
                const id = typeof item.id === 'string' ? item.id : '';
                const quantity = Math.max(1, Math.min(999, Number.parseInt(item.quantity, 10) || 1));
                if (id) cart.set(id, quantity);
            });
        }
    } catch (error) {
        cart = new Map();
    }
}

function saveCart() {
    try {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify([...cart].map(([id, quantity]) => ({ id, quantity }))));
    } catch (error) {
        // El pedido sigue funcionando durante esta visita aunque el navegador bloquee el almacenamiento local.
    }
}

function reconcileCart() {
    const availableIds = new Set(publicBooks.map(book => book.id));
    let changed = false;
    [...cart.keys()].forEach(id => {
        if (!availableIds.has(id)) {
            cart.delete(id);
            changed = true;
        }
    });
    if (changed) saveCart();
}

function addToCart(id, quantity = 1) {
    const book = getBook(id);
    if (!book) return;
    const current = cart.get(id) || 0;
    cart.set(id, Math.min(999, current + Math.max(1, Number.parseInt(quantity, 10) || 1)));
    saveCart();
    renderCart();
    showToast(`“${book.title}” se agregó a tu pedido.`);
}

function updateCartItem(id, delta) {
    if (!cart.has(id)) return;
    const next = (cart.get(id) || 1) + delta;
    if (next < 1) cart.delete(id);
    else cart.set(id, Math.min(999, next));
    saveCart();
    renderCart();
}

function removeCartItem(id) {
    cart.delete(id);
    saveCart();
    renderCart();
}

function renderCart() {
    const validItems = [...cart].map(([id, quantity]) => ({ book: getBook(id), quantity })).filter(item => item.book);
    const unitCount = validItems.reduce((sum, item) => sum + item.quantity, 0);
    const total = validItems.reduce((sum, item) => sum + Number(item.book.price || 0) * item.quantity, 0);
    document.getElementById('cart-count').textContent = unitCount;
    document.getElementById('cart-total').textContent = formatMoney(total);
    document.getElementById('send-cart').disabled = !validItems.length || !publicWhatsapp;
    document.getElementById('clear-cart').hidden = !validItems.length;

    const container = document.getElementById('cart-items');
    if (!validItems.length) {
        container.innerHTML = '<div class="cart-empty"><span aria-hidden="true">▣</span><strong>Tu pedido está vacío</strong><p>Agregá uno o varios libros y aparecerán en esta lista.</p></div>';
        return;
    }
    container.innerHTML = validItems.map(({ book, quantity }) => `
        <article class="cart-item">
            <div class="cart-cover">${coverMarkup(book, 'cart-cover-image')}</div>
            <div class="cart-copy">
                <strong>${escapeHtml(book.title)}</strong>
                <small>${formatMoney(Number(book.price || 0) * quantity)}</small>
                <div class="cart-controls">
                    <button type="button" data-cart-action="minus" data-cart-id="${escapeHtml(book.id)}" aria-label="Restar un ejemplar">−</button>
                    <span>${quantity}</span>
                    <button type="button" data-cart-action="plus" data-cart-id="${escapeHtml(book.id)}" aria-label="Sumar un ejemplar">+</button>
                </div>
            </div>
            <button class="remove-item" type="button" data-cart-action="remove" data-cart-id="${escapeHtml(book.id)}" aria-label="Quitar ${escapeHtml(book.title)}">×</button>
        </article>`).join('');
}

function openCart() {
    drawerBackdrop.hidden = false;
    drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('has-drawer');
    requestAnimationFrame(() => drawer.classList.add('is-open'));
    document.getElementById('close-cart').focus();
}

function closeCart() {
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('has-drawer');
    window.setTimeout(() => { drawerBackdrop.hidden = true; }, 260);
}

function sendCart() {
    const items = [...cart].map(([id, quantity]) => ({ book: getBook(id), quantity })).filter(item => item.book);
    if (!items.length) return;
    const total = items.reduce((sum, item) => sum + Number(item.book.price || 0) * item.quantity, 0);
    const lines = items.map(({ book, quantity }) => `• ${quantity} × ${book.title} — ${formatMoney(Number(book.price || 0) * quantity)}`);
    const message = `Hola INPERU, quiero consultar por este pedido:\n\n${lines.join('\n')}\n\nTotal estimado del catálogo: ${formatMoney(total)}.\n\n¿Me confirman disponibilidad y forma de entrega?`;
    openWhatsapp(message);
}

function showToast(message) {
    const toast = document.getElementById('toast');
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('is-visible');
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

function loadLocalPreview() {
    const previewAllowed = ['localhost', '127.0.0.1'].includes(window.location.hostname)
        && new URLSearchParams(window.location.search).get('preview') === '1';
    if (!previewAllowed) return false;
    const previewTitles = [
        'Introducción a la Psicología', 'Atlas de Anatomía', 'Matemática Aplicada',
        'Historia Contemporánea', 'Manual de Enfermería', 'Derecho Constitucional',
        'Biología Esencial', 'Economía y Sociedad', 'Diseño y Comunicación',
        'Educación Inicial', 'Literatura Argentina'
    ];
    const previewGenres = ['Psicología', 'Medicina y Salud', 'Ciencias', 'Historia', 'Medicina y Salud', 'Derecho', 'Ciencias', 'Administración y Economía', 'Arquitectura y Diseño', 'Educación', 'Literatura'];
    publicBooks = previewTitles.map((title, index) => ({
        id: `preview-${index + 1}`,
        title,
        author: ['María López', 'Equipo Académico', 'Carlos Méndez'][index % 3],
        genre: previewGenres[index],
        description: 'Edición impresa preparada por INPERU Producciones para una lectura clara, cómoda y duradera.',
        deliverables: 'Impreso en papel de 80 g, tapa laminada y anillado plástico. Terminación sujeta a disponibilidad.',
        pages: 104 + index * 22,
        format: index % 3 === 0 ? 'A4' : 'A5',
        printMode: index % 2 === 0 ? 'doble' : 'simple',
        colorMode: index % 4 === 0 ? 'color' : 'bw',
        coverImage: null,
        price: 12800 + index * 1750,
        available: true,
        featured: index < 5,
        updatedAt: { seconds: 1800000000 - index * 1000 }
    }));
    publicWhatsapp = '';
    reconcileCart();
    updateContactLinks();
    renderGenreOptions();
    renderCart();
    renderCatalog();
    statusBox.textContent += ' · vista previa local';
    return true;
}

searchInput.addEventListener('input', renderCatalog);
clearSearchButton.addEventListener('click', () => {
    searchInput.value = '';
    searchInput.focus();
    renderCatalog();
});
document.getElementById('catalog-filters').addEventListener('click', event => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    activeFilter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('is-active', item === button));
    renderCatalog();
});
document.getElementById('genre-filter').addEventListener('change', event => {
    activeGenre = event.target.value;
    renderCatalog();
});
shelves.addEventListener('click', event => {
    const showAllButton = event.target.closest('[data-show-all]');
    if (showAllButton) {
        activeFilter = 'all';
        document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('is-active', item.dataset.filter === 'all'));
        renderCatalog();
        return;
    }
    const addButton = event.target.closest('[data-add-id]');
    if (addButton) {
        addToCart(addButton.dataset.addId);
        return;
    }
    const bookButton = event.target.closest('[data-book-id]');
    if (bookButton) openBook(bookButton.dataset.bookId);
});
document.getElementById('detail-close').addEventListener('click', () => dialog.close());
document.getElementById('detail-order').addEventListener('click', orderActiveBook);
document.getElementById('detail-add').addEventListener('click', () => {
    if (!activeBook) return;
    addToCart(activeBook.id, document.getElementById('detail-quantity').value);
    dialog.close();
    openCart();
});
document.getElementById('quantity-minus').addEventListener('click', () => setQuantityInput(Number(document.getElementById('detail-quantity').value) - 1));
document.getElementById('quantity-plus').addEventListener('click', () => setQuantityInput(Number(document.getElementById('detail-quantity').value) + 1));
document.getElementById('detail-quantity').addEventListener('change', event => setQuantityInput(event.target.value));
dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
});
document.getElementById('open-cart').addEventListener('click', openCart);
document.getElementById('close-cart').addEventListener('click', closeCart);
drawerBackdrop.addEventListener('click', closeCart);
document.getElementById('clear-cart').addEventListener('click', () => {
    cart.clear();
    saveCart();
    renderCart();
});
document.getElementById('send-cart').addEventListener('click', sendCart);
document.getElementById('cart-items').addEventListener('click', event => {
    const button = event.target.closest('[data-cart-action]');
    if (!button) return;
    const id = button.dataset.cartId;
    if (button.dataset.cartAction === 'plus') updateCartItem(id, 1);
    if (button.dataset.cartAction === 'minus') updateCartItem(id, -1);
    if (button.dataset.cartAction === 'remove') removeCartItem(id);
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drawer.classList.contains('is-open')) closeCart();
});

loadCart();
renderCart();

if (!loadLocalPreview()) {
    try {
        firebase.initializeApp(firebaseConfig);
        const db = firebase.firestore();
        db.collection('publicSettings').doc('contact').onSnapshot(snapshot => {
            publicWhatsapp = normalizeWhatsapp(snapshot.exists ? snapshot.data().whatsapp : '');
            updateContactLinks();
            renderCart();
            if (dialog.open && activeBook) document.getElementById('detail-order').disabled = !publicWhatsapp;
        }, () => {
            publicWhatsapp = '';
            updateContactLinks();
            renderCart();
        });
        db.collection('publicCatalog').onSnapshot(snapshot => {
            publicBooks = [];
            snapshot.forEach(documentSnapshot => {
                const data = documentSnapshot.data();
                if (data.available !== false) publicBooks.push({ id: documentSnapshot.id, ...data });
            });
            publicBooks.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'es', { sensitivity: 'base' }));
            reconcileCart();
            renderGenreOptions();
            renderCart();
            renderCatalog();
        }, error => {
            console.error('No se pudo leer el catálogo público:', error);
            statusBox.textContent = 'No pudimos cargar la biblioteca. Intentá nuevamente más tarde.';
            shelves.innerHTML = '<div class="empty-state"><strong>El catálogo no está disponible</strong><span>Revisá tu conexión y volvé a intentarlo.</span></div>';
        });
    } catch (error) {
        console.error('No se pudo iniciar el catálogo:', error);
        statusBox.textContent = 'La biblioteca no está disponible en este momento.';
        shelves.innerHTML = '<div class="empty-state"><strong>No pudimos iniciar el catálogo</strong><span>Volvé a intentarlo más tarde.</span></div>';
    }
}
