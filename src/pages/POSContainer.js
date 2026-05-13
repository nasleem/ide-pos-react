import React, { useState, useEffect, useRef } from 'react';
import SearchBar from '../components/SearchBar';
import ProductCard from '../components/ProductCard';
import CartItem from '../components/CartItem';
import ConfirmModal from '../components/ConfirmModal';

const POSContainer = () => {
    const [posConfig, setPosConfig]           = useState(null);
    const [cart, setCart]                     = useState([]);
    const [products, setProducts]             = useState([]);
    const [loading, setLoading]               = useState(true);
    const [seeding, setSeeding]               = useState(false);
    const [currentVersionId, setCurrentVersionId] = useState(null);
    const [versionMissing, setVersionMissing] = useState(false);
    const [modal, setModal]                   = useState({ isOpen: false, product: null });

    const API_BASE    = "/api/v1";
    const debounceRef = useRef(null);

    // Cache UOM per produk agar tidak fetch berulang
    const uomCacheRef = useRef({});

    // ─── API helper ───────────────────────────────────────────────────────────
    const customFetch = async (url, options = {}) => {
        const token    = localStorage.getItem("token");
        const response = await fetch(`${API_BASE}${url}`, {
            ...options,
            headers: {
                ...options.headers,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }
        return response.json();
    };

    // ─── 1. Init ─────────────────────────────────────────────────────────────
    useEffect(() => {
        const initPOS = async () => {
            try {
                const loginUserId = localStorage.getItem("AD_User_ID");
                if (!loginUserId) { alert("Sesi user tidak ditemukan."); setLoading(false); return; }
                const data = await customFetch(
                    `/models/c_pos?$filter=SalesRep_ID eq ${loginUserId}&$expand=SalesRep_ID($select=Name)`
                );
                if (data?.records?.length > 0) {
                    const terminalConfig = data.records[0];
                    setPosConfig(terminalConfig);
                    const priceListId = terminalConfig.M_PriceList_ID?.id;
                    if (priceListId) {
                        await fetchProducts("", priceListId, terminalConfig);
                    } else {
                        alert("M_PriceList_ID tidak ditemukan pada konfigurasi terminal.");
                    }
                } else {
                    alert(`Terminal tidak ditemukan untuk SalesRep ID: ${loginUserId}`);
                }
            } catch (err) {
                console.error("Error loading C_POS:", err.message);
                alert("Gagal memuat POS: " + err.message);
            } finally {
                setLoading(false);
            }
        };
        initPOS();
    }, []);

    // ─── 2. Fetch products ────────────────────────────────────────────────────
    const fetchProducts = async (query = "", priceListId = null, terminalConfig = null) => {
        try {
            setLoading(true);
            setVersionMissing(false);
            const config           = terminalConfig || posConfig;
            const rawPriceId       = priceListId || config?.M_PriceList_ID;
            const finalPriceListId = typeof rawPriceId === 'object' ? rawPriceId?.id : rawPriceId;
            if (!finalPriceListId) { console.error("PriceList ID tidak ditemukan"); return; }

            const versionRes    = await customFetch(
                `/models/m_pricelist_version?$filter=M_PriceList_ID eq ${finalPriceListId} and IsActive eq true&$orderby=ValidFrom desc&$top=1`
            );
            const activeVersion = versionRes?.records?.[0];
            if (!activeVersion) {
                setCurrentVersionId("NOT_FOUND"); setVersionMissing(true); setProducts([]);
                return;
            }

            const versionId = activeVersion.id || activeVersion.M_PriceList_Version_ID?.id || activeVersion.M_PriceList_Version_ID;
            setCurrentVersionId(versionId);
            setVersionMissing(false);

            const priceData       = await customFetch(
                `/models/m_productprice?$filter=M_PriceList_Version_ID eq ${versionId}&$select=M_Product_ID,PriceStd`
            );
            const priceMap        = new Map();
            const rawPriceRecords = Array.isArray(priceData.records) ? priceData.records : (priceData.records ? [priceData.records] : []);
            rawPriceRecords.forEach(p => {
                const pid = p.M_Product_ID?.id ?? p.M_Product_ID ?? p.id;
                if (pid != null) priceMap.set(pid, p.PriceStd);
            });

            let productFilter = "IsSold eq true and IsActive eq true";
            if (query) {
                const safeQuery = query.toUpperCase().replace(/'/g, "''");
                productFilter += ` and (contains(toupper(Name),'${safeQuery}') or contains(toupper(Value),'${safeQuery}'))`;
            }

            const productData    = await customFetch(
                `/models/m_product?$select=M_Product_ID,Name,Value,C_UOM_ID&$filter=${productFilter}&$top=50`
            );
            const productRecords = Array.isArray(productData.records) ? productData.records : (productData.records ? [productData.records] : []);

            const finalProducts = productRecords.map(p => {
                const pId   = p.M_Product_ID?.id ?? p.M_Product_ID ?? p.id;
                const price = priceMap.get(pId);
                if (price === undefined) return null;
                // Simpan default UOM dari m_product
                const defaultUOM = {
                    id:           p.C_UOM_ID?.id ?? p.C_UOM_ID,
                    name:         p.C_UOM_ID?.Name || p.C_UOM_ID?.identifier || 'EA',
                    multiplyRate: 1, // default UOM selalu rate 1
                };
                return { M_Product_ID: pId, Name: p.Name, Value: p.Value, Price: price ?? 0, basePrice: price ?? 0, defaultUOM };
            }).filter(Boolean);

            console.log("✅ finalProducts length:", finalProducts.length);
            setProducts(finalProducts);
        } catch (err) {
            console.error("Fetch Products Error:", err.message);
            setProducts([]);
        } finally {
            setLoading(false);
        }
    };

    // ─── 3. Fetch UOM options untuk satu produk ───────────────────────────────
    // Mengembalikan array [{ id, name, multiplyRate }]
    // Index 0 selalu UOM default produk (rate = 1)
    const fetchUOMOptions = async (product) => {
        const productId = product.M_Product_ID;

        // Pakai cache agar tidak fetch ulang
        if (uomCacheRef.current[productId]) {
            return uomCacheRef.current[productId];
        }

        const defaultUOM = product.defaultUOM || { id: null, name: 'EA', multiplyRate: 1 };
        const defaultOption = { id: defaultUOM.id, name: defaultUOM.name, multiplyRate: 1 };

        try {
            // Fetch konversi UOM yang spesifik untuk produk ini,
            // ATAU konversi umum dari UOM default (M_Product_ID is null berarti berlaku untuk semua produk)
            const defaultUomId = defaultUOM.id;
            if (!defaultUomId) return [defaultOption];

            const filter = `C_UOM_ID eq ${defaultUomId} and (M_Product_ID eq ${productId} or M_Product_ID eq null) and IsActive eq true`;
            const res    = await customFetch(
                `/models/c_uom_conversion?$filter=${filter}&$select=C_UOM_ID,C_UOM_To_ID,MultiplyRate,M_Product_ID`
            );

            const conversions = Array.isArray(res.records) ? res.records : [];

            // Bangun opsi UOM: default + semua konversi
            const options = [defaultOption];
            conversions.forEach(conv => {
                const toId   = conv.C_UOM_To_ID?.id   ?? conv.C_UOM_To_ID;
                const toName = conv.C_UOM_To_ID?.Name  || conv.C_UOM_To_ID?.identifier || `UOM #${toId}`;
                const rate   = conv.MultiplyRate ?? 1;
                // Hindari duplikat
                if (toId && !options.find(o => o.id === toId)) {
                    options.push({ id: toId, name: toName, multiplyRate: rate });
                }
            });

            uomCacheRef.current[productId] = options;
            return options;
        } catch (err) {
            console.warn("Gagal fetch UOM conversion untuk produk", productId, err.message);
            return [defaultOption];
        }
    };

    // ─── 4. Add to cart (fetch UOM dulu) ─────────────────────────────────────
    const addToCart = async (product) => {
        const existingIndex = cart.findIndex(item => item.M_Product_ID === product.M_Product_ID);
        if (existingIndex !== -1) {
            // Produk sudah ada → tambah qty saja
            setCart(prev => prev.map((item, i) =>
                i === existingIndex ? { ...item, qty: item.qty + 1 } : item
            ));
            return;
        }

        if (product.Price === 0) {
            setModal({ isOpen: true, product });
            return;
        }

        // Fetch UOM options lalu tambah ke cart
        const uomOptions = await fetchUOMOptions(product);
        const selectedUOM = uomOptions[0]; // default UOM

        setCart(prev => [...prev, {
            ...product,
            qty:         1,
            uomOptions,
            selectedUOM,
        }]);
    };

    // ─── 5. Modal confirm (produk harga 0) ───────────────────────────────────
    const handleModalConfirm = async () => {
        const product    = modal.product;
        const uomOptions = await fetchUOMOptions(product);
        setCart(prev => [...prev, {
            ...product,
            qty:         1,
            uomOptions,
            selectedUOM: uomOptions[0],
        }]);
        setModal({ isOpen: false, product: null });
    };

    const handleModalCancel = () => setModal({ isOpen: false, product: null });

    // ─── 6. Cart handlers ─────────────────────────────────────────────────────
    const removeFromCart  = (id)        => setCart(prev => prev.filter(i => i.M_Product_ID !== id));
    const calculateTotal  = ()          => cart.reduce((s, i) => s + i.Price * i.qty, 0);

    const updateCartQty = (id, value) => {
        const qty = parseInt(value, 10);
        if (isNaN(qty) || qty < 1) return;
        setCart(prev => prev.map(i => i.M_Product_ID === id ? { ...i, qty } : i));
    };

    const updateCartPrice = (id, value) => {
        const price = parseFloat(value);
        if (isNaN(price) || price < 0) return;
        setCart(prev => prev.map(i => i.M_Product_ID === id ? { ...i, Price: price } : i));
    };

    // Saat UOM diganti: sesuaikan harga berdasarkan multiplyRate konversi
    // Harga baru = basePrice (harga satuan default) × multiplyRate UOM baru
    const updateCartUOM = (id, uomOption) => {
        setCart(prev => prev.map(item => {
            if (item.M_Product_ID !== id) return item;
            const newPrice = item.basePrice / uomOption.multiplyRate;
            return {
                ...item,
                selectedUOM: uomOption,
                Price:       newPrice,
            };
        }));
    };

    // ─── 7. Search ────────────────────────────────────────────────────────────
    const handleSearch = (e) => {
        const val = e.target.value;
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            const id = posConfig?.M_PriceList_ID?.id || posConfig?.M_PriceList_ID;
            fetchProducts(val, id);
        }, 400);
    };

    // ─── 8. Checkout ──────────────────────────────────────────────────────────
    const handleCheckout = async () => {
        if (cart.length === 0) return alert("Keranjang Kosong!");
        try {
            const resHeader = await customFetch('/models/c_order', {
                method: 'POST',
                body: JSON.stringify({
                    AD_Org_ID:          posConfig.AD_Org_ID,
                    C_DocTypeTarget_ID: posConfig.C_DocType_ID,
                    M_Warehouse_ID:     posConfig.M_Warehouse_ID,
                    M_PriceList_ID:     posConfig.M_PriceList_ID,
                    C_BPartner_ID:      posConfig.C_BPartner_ID,
                    DateOrdered:        new Date().toISOString(),
                }),
            });
            const newOrderID  = resHeader.id;
            const failedLines = [];
            for (const item of cart) {
                try {
                    await customFetch('/models/c_orderline', {
                        method: 'POST',
                        body: JSON.stringify({
                            C_Order_ID:   newOrderID,
                            AD_Org_ID:    posConfig.AD_Org_ID,
                            M_Product_ID: item.M_Product_ID,
                            C_UOM_ID:     item.selectedUOM?.id,   // kirim UOM yang dipilih
                            QtyOrdered:   item.qty,
                            PriceEntered: item.Price,
                            PriceActual:  item.Price,
                        }),
                    });
                } catch { failedLines.push(item.Name); }
            }
            if (failedLines.length > 0) {
                alert(`Order dibuat (${resHeader.documentNo}) tapi baris berikut gagal:\n${failedLines.join('\n')}`);
            } else {
                alert(`Order Berhasil: ${resHeader.documentNo || 'Sukses'}`);
                setCart([]);
            }
        } catch (err) {
            console.error("Checkout Error:", err.message);
            alert("Gagal memproses pesanan: " + err.message);
        }
    };

    if (loading && !posConfig) return <p style={{ padding: '20px' }}>Loading Config POS...</p>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px', fontFamily: 'Arial, sans-serif', height: '100vh', boxSizing: 'border-box', overflow: 'hidden' }}>

            <ConfirmModal
                isOpen={modal.isOpen}
                title="Produk Tanpa Harga"
                message={
                    <>
                        Produk <strong>{modal.product?.Name}</strong> tidak memiliki harga
                        di Price List yang dipilih.<br /><br />
                        Tetap tambahkan ke cart dengan harga Rp 0?
                    </>
                }
                confirmLabel="OK, Tambahkan"
                cancelLabel="Batal"
                onConfirm={handleModalConfirm}
                onCancel={handleModalCancel}
            />

            {/* Debug Panel */}
            {process.env.NODE_ENV === 'development' && (
                <div style={{ background: '#f4f4f4', padding: '15px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '12px' }}>
                    <h4 style={{ margin: '0 0 10px 0', color: '#333' }}>🛠 POS Configuration Debugger</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                        <div><strong>SalesRep:</strong> {posConfig?.SalesRep_ID?.Name || 'Not Found'}</div>
                        <div><strong>POS Name:</strong> {posConfig?.Name || 'Loading...'}</div>
                        <div><strong>Warehouse:</strong> {posConfig?.M_Warehouse_ID?.id || 'Not Found'}</div>
                        <div><strong>PriceList ID:</strong> {posConfig?.M_PriceList_ID?.id || 'Not Found'}</div>
                        <div><strong>PL Version ID:</strong> {currentVersionId || <span style={{ color: 'red' }}>Not Found</span>}</div>
                        <div><strong>Status:</strong> {loading ? 'Fetching...' : 'Ready'}</div>
                    </div>
                </div>
            )}

            {/* Main Layout */}
            <div style={{ display: 'flex', gap: '0', height: 'calc(100vh - 180px)', minHeight: '500px' }}>

                {/* Kiri: Search + Product Grid */}
                <div style={{ flex: 2, display: 'flex', flexDirection: 'column', paddingRight: '20px', overflow: 'hidden' }}>
                    <h3 style={{ margin: '0 0 10px 0' }}>Product Catalog</h3>
                    <SearchBar onChange={handleSearch} disabled={versionMissing} />
                    <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
                        {loading ? (
                            <p>Memuat produk...</p>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                                {products.length > 0
                                    ? products.map((p, index) => (
                                        <ProductCard
                                            key={`${p.M_Product_ID}-${index}`}
                                            product={p}
                                            onClick={addToCart}
                                        />
                                    ))
                                    : !versionMissing && (
                                        <p style={{ gridColumn: 'span 3', textAlign: 'center', color: '#999' }}>
                                            Tidak ada produk ditemukan dengan harga aktif.
                                        </p>
                                    )
                                }
                            </div>
                        )}
                    </div>
                </div>

                {/* Kanan: Cart */}
                <div style={{ flex: 1, borderLeft: '1px solid #ddd', paddingLeft: '20px', display: 'flex', flexDirection: 'column', minWidth: '280px' }}>
                    <h3 style={{ margin: '0 0 10px 0' }}>🛒 Cart</h3>
                    <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
                        {cart.length === 0 && <p style={{ color: '#999' }}>Keranjang kosong</p>}
                        {cart.map((item, index) => (
                            <CartItem
                                key={`${item.M_Product_ID}-${index}`}
                                item={item}
                                onRemove={removeFromCart}
                                onQtyChange={updateCartQty}
                                onPriceChange={updateCartPrice}
                                onUOMChange={updateCartUOM}
                            />
                        ))}
                    </div>
                    {cart.length > 0 && (
                        <div style={{ borderTop: '1px solid #ddd', paddingTop: '12px', marginTop: '8px', flexShrink: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '15px', fontWeight: 'bold' }}>
                                <span>Total:</span>
                                <span style={{ color: '#2e7d32' }}>Rp {calculateTotal().toLocaleString('id-ID')}</span>
                            </div>
                            <button onClick={handleCheckout}
                                style={{ background: '#28a745', color: 'white', border: 'none', padding: '14px', width: '100%', borderRadius: '8px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer' }}>
                                PROSES BAYAR
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default POSContainer;