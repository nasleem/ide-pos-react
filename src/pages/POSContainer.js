import React, { useState, useEffect, useRef } from 'react';
import SearchBar from '../components/SearchBar';
import ProductCard from '../components/ProductCard';
import CartItem from '../components/CartItem';
import ConfirmModal from '../components/ConfirmModal';
import PaymentModal from '../components/PaymentModal';

const POSContainer = () => {
    const [posConfig, setPosConfig]               = useState(null);
    const [cart, setCart]                         = useState([]);
    const [products, setProducts]                 = useState([]);
    const [loading, setLoading]                   = useState(true);
    const [currentVersionId, setCurrentVersionId] = useState(null);
    const [versionMissing, setVersionMissing]     = useState(false);
    const [modal, setModal]                       = useState({ isOpen: false, product: null });
    const [isProcessingCheckout, setIsProcessingCheckout] = useState(false);

    // State untuk combobox C_BPartner dan M_PriceList di config bar
    const [bPartnerList, setBPartnerList]   = useState([]);
    const [priceListList, setPriceListList] = useState([]);
    const [selectedBPartner, setSelectedBPartner] = useState(null); // { id, name }
    const [selectedPriceList, setSelectedPriceList] = useState(null); // { id, name }

    const API_BASE    = "/api/v1";
    const debounceRef = useRef(null);
    const uomCacheRef = useRef({});

    // ─── API helper ───────────────────────────────────────────────────────────
    const customFetch = async (url, options = {}) => {
        const token    = localStorage.getItem("token");
        const fullUrl  = `${API_BASE}${url}`;
        const response = await fetch(fullUrl, {
            ...options,
            headers: {
                ...options.headers,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            // FIX: log detail lengkap agar mudah debug
            const rawText   = await response.text().catch(() => '');
            let errorData   = {};
            try { errorData = JSON.parse(rawText); } catch (_) {}

            // iDempiere bisa kembalikan error di berbagai field
            const errMsg =
                errorData.message  ||
                errorData.Message  ||
                errorData.error    ||
                errorData.Error    ||
                errorData.detail   ||
                rawText            ||
                `HTTP ${response.status}`;

            console.error(`❌ API Error [${response.status}] ${options.method || 'GET'} ${fullUrl}`);
            console.error('Response body:', rawText);
            if (options.body) {
                console.error('Request payload:', options.body);
            }

            throw new Error(`[${response.status}] ${errMsg}`);
        }
        return response.json();
    };

    // ─── 1. Init (mengambil data C_POS) ──────────────────────────────────────
    // FIX: Hapus $select dan $expand — iDempiere REST mengembalikan 400 jika $select
    // menyertakan field FK (SalesRep_ID, M_PriceList_ID, dll). Ambil semua field.
    useEffect(() => {
        const initPOS = async () => {
            try {
                const loginUserId = localStorage.getItem("AD_User_ID");
                if (!loginUserId) { alert("Sesi user tidak ditemukan."); setLoading(false); return; }

                const data = await customFetch(
                    `/models/c_pos?$filter=SalesRep_ID eq ${loginUserId}`
                );

                if (data?.records?.length > 0) {
                    const terminalConfig = data.records[0];
                    setPosConfig(terminalConfig);

                    const priceListId = terminalConfig.M_PriceList_ID?.id ?? terminalConfig.M_PriceList_ID;
                    if (priceListId) {
                        // Set default selectedPriceList dari config terminal
                        const plName = terminalConfig.M_PriceList_ID?.identifier || terminalConfig.M_PriceList_ID?.Name || `PriceList #${priceListId}`;
                        setSelectedPriceList({ id: priceListId, name: plName });
                        await fetchProducts("", priceListId, terminalConfig);
                    } else {
                        alert("M_PriceList_ID tidak ditemukan pada konfigurasi terminal.");
                    }

                    // Set default selectedBPartner dari config terminal (jika ada)
                    const bpId = terminalConfig.C_BPartner_ID?.id ?? terminalConfig.C_BPartner_ID;
                    if (bpId) {
                        const bpName = terminalConfig.C_BPartner_ID?.identifier || terminalConfig.C_BPartner_ID?.Name || `BPartner #${bpId}`;
                        setSelectedBPartner({ id: bpId, name: bpName });
                    }

                    // Fetch daftar BPartner (Customer) dan PriceList untuk combobox
                    await Promise.all([
                        fetchBPartnerOptions(),
                        fetchPriceListOptions(terminalConfig),
                    ]);
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

    // ─── 1b. Fetch opsi BPartner untuk combobox ──────────────────────────────
    const fetchBPartnerOptions = async () => {
        try {
            const res = await customFetch(
                `/models/c_bpartner?$filter=IsActive eq true and IsCustomer eq true&$select=C_BPartner_ID,Name&$orderby=Name&$top=100`
            );
            const records = Array.isArray(res.records) ? res.records : [];
            const options = records.map(bp => ({
                id:   bp.C_BPartner_ID?.id ?? bp.C_BPartner_ID ?? bp.id,
                name: bp.Name,
            })).filter(o => o.id);
            setBPartnerList(options);
        } catch (err) {
            console.warn("Gagal fetch BPartner list:", err.message);
        }
    };

    // ─── 1c. Fetch opsi PriceList untuk combobox ─────────────────────────────
    const fetchPriceListOptions = async (terminalConfig) => {
        try {
            const config  = terminalConfig || posConfig;
            const adOrgId = config?.AD_Org_ID?.id ?? config?.AD_Org_ID;
            const filter  = adOrgId
                ? `IsActive eq true and (AD_Org_ID eq 0 or AD_Org_ID eq ${adOrgId})`
                : `IsActive eq true`;
            const res = await customFetch(
                `/models/m_pricelist?$filter=${filter}&$select=M_PriceList_ID,Name&$orderby=Name&$top=50`
            );
            const records = Array.isArray(res.records) ? res.records : [];
            const options = records.map(pl => ({
                id:   pl.M_PriceList_ID?.id ?? pl.M_PriceList_ID ?? pl.id,
                name: pl.Name,
            })).filter(o => o.id);
            setPriceListList(options);
        } catch (err) {
            console.warn("Gagal fetch PriceList:", err.message);
        }
    };

    // ─── 1d. Handler ganti BPartner ──────────────────────────────────────────
    const handleBPartnerChange = (e) => {
        const id   = parseInt(e.target.value, 10);
        const name = e.target.options[e.target.selectedIndex].text;
        setSelectedBPartner({ id, name });
    };

    // ─── 1e. Handler ganti PriceList → reload produk ─────────────────────────
    const handlePriceListChange = async (e) => {
        const id   = parseInt(e.target.value, 10);
        const name = e.target.options[e.target.selectedIndex].text;
        setSelectedPriceList({ id, name });
        await fetchProducts("", id);
    };

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
                setCurrentVersionId("NOT_FOUND");
                setVersionMissing(true);
                setProducts([]);
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

            // $select hanya field primitif + FK yang aman untuk m_product
            const productData    = await customFetch(
                `/models/m_product?$select=M_Product_ID,Name,Value,C_UOM_ID&$filter=${productFilter}&$top=50`
            );
            const productRecords = Array.isArray(productData.records) ? productData.records : (productData.records ? [productData.records] : []);

            // FIX: simpan sebagai PriceActual (bukan Price) agar konsisten dengan iDempiere & cart
            const finalProducts = productRecords.map(p => {
                const pId   = p.M_Product_ID?.id ?? p.M_Product_ID ?? p.id;
                const price = priceMap.get(pId);
                if (price === undefined) return null;

                const defaultUOM = {
                    id:           p.C_UOM_ID?.id ?? p.C_UOM_ID,
                    name:         p.C_UOM_ID?.Name || p.C_UOM_ID?.identifier || 'EA',
                    multiplyRate: 1,
                };

                return {
                    M_Product_ID: pId,
                    Name:         p.Name,
                    Value:        p.Value,
                    PriceActual:  price ?? 0,
                    basePrice:    price ?? 0,
                    defaultUOM,
                };
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
    // FIX: iDempiere tidak support "eq null" di OData filter → pisah jadi 2 request:
    //   - request 1: konversi spesifik produk (M_Product_ID eq productId)
    //   - request 2: konversi umum/global (tanpa filter M_Product_ID, ambil semua lalu filter di client)
    //   Gabungkan hasilnya, deduplikasi berdasarkan C_UOM_To_ID.
    const fetchUOMOptions = async (product) => {
        const productId = product.M_Product_ID;

        if (uomCacheRef.current[productId]) {
            return uomCacheRef.current[productId];
        }

        const defaultUOM    = product.defaultUOM || { id: null, name: 'EA', multiplyRate: 1 };
        const defaultOption = { id: defaultUOM.id, name: defaultUOM.name, multiplyRate: 1 };

        const defaultUomId = defaultUOM.id;
        if (!defaultUomId) {
            uomCacheRef.current[productId] = [defaultOption];
            return [defaultOption];
        }

        const options = [defaultOption];

        const buildOptions = (records) => {
            records.forEach(conv => {
                const toId   = conv.C_UOM_To_ID?.id  ?? conv.C_UOM_To_ID;
                const toName = conv.C_UOM_To_ID?.Name || conv.C_UOM_To_ID?.identifier || `UOM #${toId}`;
                const rate   = conv.MultiplyRate ?? 1;
                if (toId && !options.find(o => o.id === toId)) {
                    options.push({ id: toId, name: toName, multiplyRate: rate });
                }
            });
        };

        try {
            // Request 1: konversi spesifik untuk produk ini
            const resProduct = await customFetch(
                `/models/c_uom_conversion?$filter=C_UOM_ID eq ${defaultUomId} and M_Product_ID eq ${productId} and IsActive eq true&$select=C_UOM_ID,C_UOM_To_ID,MultiplyRate,M_Product_ID`
            );
            buildOptions(Array.isArray(resProduct.records) ? resProduct.records : []);
        } catch (err) {
            console.warn("Gagal fetch UOM spesifik produk", productId, err.message);
        }

        try {
            // Request 2: konversi umum (global) — filter M_Product_ID di client
            // Tidak pakai "eq null" karena iDempiere tidak support → ambil semua lalu filter
            const resGlobal = await customFetch(
                `/models/c_uom_conversion?$filter=C_UOM_ID eq ${defaultUomId} and IsActive eq true&$select=C_UOM_ID,C_UOM_To_ID,MultiplyRate,M_Product_ID&$top=50`
            );
            const globalRecords = (Array.isArray(resGlobal.records) ? resGlobal.records : [])
                // Filter di client: ambil hanya yang M_Product_ID null/kosong (konversi global)
                .filter(conv => !conv.M_Product_ID || conv.M_Product_ID === null);
            buildOptions(globalRecords);
        } catch (err) {
            console.warn("Gagal fetch UOM global untuk UOM", defaultUomId, err.message);
        }

        uomCacheRef.current[productId] = options;
        return options;
    };

    // ─── 4. Add to cart ───────────────────────────────────────────────────────
    const addToCart = async (product) => {
        const existingIndex = cart.findIndex(item => item.M_Product_ID === product.M_Product_ID);
        if (existingIndex !== -1) {
            setCart(prev => prev.map((item, i) =>
                i === existingIndex ? { ...item, QtyOrdered: item.QtyOrdered + 1 } : item
            ));
            return;
        }

        if (product.PriceActual === 0) {
            setModal({ isOpen: true, product });
            return;
        }

        try {
            const uomOptions         = await fetchUOMOptions(product);
            const defaultUOMFallback = product.defaultUOM || { id: null, name: 'EA', multiplyRate: 1 };
            const selectedUOM        = (Array.isArray(uomOptions) && uomOptions.length > 0)
                ? uomOptions[0]
                : { id: defaultUOMFallback.id, name: defaultUOMFallback.name, multiplyRate: 1 };

            setCart(prev => [...prev, {
                ...product,
                QtyOrdered:  1,
                PriceActual: product.PriceActual,
                basePrice:   product.PriceActual,
                uomOptions:  Array.isArray(uomOptions) && uomOptions.length > 0 ? uomOptions : [selectedUOM],
                selectedUOM,
            }]);
        } catch (err) {
            console.error("Gagal menambahkan item karena masalah UOM:", err.message);
            const emergencyUOM = { id: product.defaultUOM?.id, name: product.defaultUOM?.name || 'EA', multiplyRate: 1 };
            setCart(prev => [...prev, {
                ...product,
                QtyOrdered:  1,
                PriceActual: product.PriceActual,
                basePrice:   product.PriceActual,
                uomOptions:  [emergencyUOM],
                selectedUOM: emergencyUOM,
            }]);
        }
    };

    // ─── 5. Modal confirm (produk harga 0) ───────────────────────────────────
    const handleModalConfirm = async () => {
        const product    = modal.product;
        const uomOptions = await fetchUOMOptions(product);
        setCart(prev => [...prev, {
            ...product,
            QtyOrdered:  1,
            PriceActual: product.PriceActual,
            basePrice:   product.PriceActual,
            uomOptions,
            selectedUOM: uomOptions[0],
        }]);
        setModal({ isOpen: false, product: null });
    };

    const handleModalCancel = () => setModal({ isOpen: false, product: null });

    // ─── 6. Cart handlers ─────────────────────────────────────────────────────
    const removeFromCart = (id) => setCart(prev => prev.filter(i => i.M_Product_ID !== id));

    const calculateTotal = () => cart.reduce((s, i) => s + (i.PriceActual * i.QtyOrdered), 0);

    const updateCartQty = (id, value) => {
        const qty = parseInt(value, 10);
        if (isNaN(qty) || qty < 1) return;
        setCart(prev => prev.map(i => i.M_Product_ID === id ? { ...i, QtyOrdered: qty } : i));
    };

    const updateCartPrice = (id, value) => {
        const price = parseFloat(value);
        if (isNaN(price) || price < 0) return;
        setCart(prev => prev.map(i => i.M_Product_ID === id ? { ...i, PriceActual: price } : i));
    };

    const updateCartUOM = (id, uomOption) => {
        setCart(prev => prev.map(item => {
            if (item.M_Product_ID !== id) return item;
            return {
                ...item,
                selectedUOM: uomOption,
                PriceActual: item.basePrice / uomOption.multiplyRate,
            };
        }));
    };

    // ─── 7. Search ────────────────────────────────────────────────────────────
    const handleSearch = (e) => {
        const val = e.target.value;
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            // FIX: gunakan selectedPriceList (dari combobox) bukan posConfig
            const id = selectedPriceList?.id || posConfig?.M_PriceList_ID?.id || posConfig?.M_PriceList_ID;
            fetchProducts(val, id);
        }, 400);
    };

    // ─── 8. Prepare payload ───────────────────────────────────────────────────
    // FIX: iDempiere REST mengharapkan FK sebagai { id: N }, bukan integer mentah.
    // FIX: field undefined harus dihapus dari payload agar tidak 500.
    const preparePayloadForIdempiere = () => {
        if (!posConfig) throw new Error("Konfigurasi C_POS belum dimuat.");

        // Helper Ekstraksi ID Aman
        const toIdMurni = (field, name) => {
            // Cek jika field berbentuk objek { id: ... } atau objek iDempiere metadata kustom
            const extracted = field?.id?.id ?? field?.id ?? (typeof field === 'number' ? field : undefined);
            const parsed = parseInt(extracted);
            if (isNaN(parsed)) {
                console.warn(`Peringatan: Field ${name} tidak memiliki ID numerik valid.`);
                return null;
            }
            return parsed;
        };

        const adClientId  = toIdMurni(posConfig.AD_Client_ID, "AD_Client_ID");
        const adOrgId     = toIdMurni(posConfig.AD_Org_ID, "AD_Org_ID");
        const bPartnerId  = selectedBPartner?.id ?? toIdMurni(posConfig.C_BPartner_ID, "C_BPartner_ID");
        const warehouseId = toIdMurni(posConfig.M_Warehouse_ID, "M_Warehouse_ID");
        const docTypeId   = toIdMurni(posConfig.C_DocType_ID, "C_DocType_ID");
        const priceListId = selectedPriceList?.id ?? toIdMurni(posConfig.M_PriceList_ID, "M_PriceList_ID");
        const salesRepId  = toIdMurni(posConfig.SalesRep_ID, "SalesRep_ID");

        // FIX SINKRONISASI ID TERMINAL KASIR:
        // Mencari ID dari objek posConfig tingkat terluar, properti C_POS_ID, maupun properti .id standar
        const posId       = toIdMurni(posConfig.C_POS_ID, "C_POS_ID_Sub") || 
                            toIdMurni(posConfig.id, "id_Utama") || 
                            toIdMurni(posConfig, "C_POS_ID_Direct");

        // Validasi Mandatory Frontend sebelum data dikirim ke REST API
        if (!bPartnerId)  throw new Error("C_BPartner_ID tidak valid. Isi field Business Partner pada setup POS.");
        if (!docTypeId)   throw new Error("C_DocType_ID tidak valid di konfigurasi POS.");
        if (!warehouseId) throw new Error("M_Warehouse_ID tidak valid di konfigurasi POS.");
        if (!posId)       throw new Error("C_POS_ID tidak valid. Pastikan variabel state posConfig memuat ID Terminal POS.");

        // Format baris lines — Pastikan format ID dibungkus objek angka murni secara konsisten
        const formattedLines = cart.map((item) => {
            const line = {
                AD_Org_ID:    { id: adOrgId },
                M_Product_ID: { id: parseInt(item.M_Product_ID?.id ?? item.M_Product_ID) },
                QtyOrdered:   parseFloat(item.QtyOrdered || 1),
                PriceActual:  parseFloat(item.PriceActual || 0),
                PriceEntered: parseFloat(item.PriceActual || 0),
            };
            
            const uomId = toIdMurni(item.selectedUOM, "C_UOM_ID");
            if (uomId) line.C_UOM_ID = { id: uomId };
            
            return line;
        });

        // Bentuk Payload Akhir untuk POST /models/c_order
        const payload = {
            AD_Client_ID:       { id: adClientId },
            AD_Org_ID:          { id: adOrgId },
            C_DocTypeTarget_ID: { id: docTypeId },
            C_BPartner_ID:      { id: bPartnerId },
            M_Warehouse_ID:     { id: warehouseId },
            M_PriceList_ID:     { id: priceListId },
            DateOrdered:        new Date().toISOString().split('T')[0],
            PaymentRule:        "M", // Mixed Mode di awal agar bisa menerima record C_POSPayment
            c_orderline:        formattedLines,
            IsSOTrx:            "Y", 
            Description:        "Request REST API Test from REACT App",

            // FIX UTAMA: Kirim objek ID numerik murni yang sudah terjamin bebas dari null/NaN
            "C_POS_ID":         { id: posId }
        };

        if (salesRepId) payload.SalesRep_ID = { id: salesRepId };

        return payload;
    };

        // Buat beberapa state baru di level komponen POSContainer Anda:
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [currentOrderData, setCurrentOrderData] = useState(null); // Menyimpan info order yang sukses dibuat

    const handleCheckout = async () => {
        if (cart.length === 0) { alert("Keranjang masih kosong!"); return; }

        setIsProcessingCheckout(true);
        try {
            const orderPayload = preparePayloadForIdempiere();

            console.log("Langkah 1: Membuat Order Draft di iDempiere...");
            const createdOrder = await customFetch("/models/c_order", {
                method: "POST",
                body: JSON.stringify(orderPayload),
            });

            const orderId = createdOrder.id || createdOrder.C_Order_ID;
            if (!orderId) throw new Error("Gagal mengambil C_Order_ID dari server.");

            console.log(`✅ Order Draft Berhasil Dibuat (ID: ${orderId}). Siap memproses pembayaran.`);
            
            // Simpan data order ke state untuk referensi di Modal Pembayaran
            setCurrentOrderData(createdOrder); 
            
            // Buka Modal Pembayaran kepada Kasir
            setIsPaymentModalOpen(true); 

        } catch (err) {
            console.error("Proses POS Checkout Gagal:", err.message);
            alert("Checkout Gagal: " + err.message);
        } finally {
            setIsProcessingCheckout(false);
        }
    };

    const handleProcessPayment = async (paymentDetails) => {
        // paymentDetails berisi: { tenderType: "X", amount: 150000 } dari form modal Anda
        if (!currentOrderData) return;

        const orderId = currentOrderData.id || currentOrderData.C_Order_ID;
        const posId = posConfig?.C_POS_ID?.id || posConfig?.C_POS_ID; // Ambil ID Terminal POS

        try {
            console.log("Langkah 2: Mengirim data pembayaran ke C_POSPayment...");
            
            const paymentPayload = {
                AD_Client_ID:   { id: currentOrderData.AD_Client_ID?.id },
                AD_Org_ID:      { id: currentOrderData.AD_Org_ID?.id },
                C_Order_ID:     { id: orderId },
                C_POS_ID:       { id: posId },
                PayAmt:         paymentDetails.amount,     // Jumlah uang yang dibayarkan
                TenderType:     paymentDetails.tenderType, // Kode bawaan iDempiere: "X" (Cash), "K" (Credit Card), "D" (Direct Deposit) dsb.
                POSTenderType:  paymentDetails.tenderType,
            };

            // POST Pembayaran ke iDempiere
            await customFetch("/models/c_pospayment", {
                method: "POST",
                body: JSON.stringify(paymentPayload),
            });

            console.log("✅ Pembayaran sukses dicatat. Langkah 3: Melakukan Complete Order...");

            // Jalankan PUT resmi doc-action menggunakan solusi google group yang telah berhasil kemarin
            const completedOrder = await customFetch(`/models/c_order/${orderId}`, {
                method: "PUT",
                body: JSON.stringify({
                    "doc-action": "CO" // Memasukkan perintah complete lewat kebab-case resmi
                }),
            });

            const finalDocNo = completedOrder.DocumentNo || currentOrderData.DocumentNo || orderId;
            alert(`Transaksi Lunas & Sukses! Nomor Dokumen: ${finalDocNo}`);
            
            // Selesai total, bersihkan state kasir
            setIsPaymentModalOpen(false);
            setCurrentOrderData(null);
            setCart([]); 

        } catch (err) {
            console.error("Proses Pembayaran POS Gagal:", err.message);
            alert("Gagal memproses pembayaran: " + err.message);
        }
    };

const handleCompletePOSPaymentWorkflow = async (cleanPaymentsArray) => {
    if (!currentOrderData) return;
    
    const orderId = currentOrderData.id || currentOrderData.C_Order_ID;

    try {
        console.log("Memulai pengiriman multi-baris C_POSPayment...");
        
        const adClientId = currentOrderData.AD_Client_ID?.id ?? currentOrderData.AD_Client_ID;
        const adOrgId = currentOrderData.AD_Org_ID?.id ?? currentOrderData.AD_Org_ID;

        // Langkah 1: POST semua baris data pembayaran ke C_POSPayment
        for (const payment of cleanPaymentsArray) {
            
            // VALIDASI EKSTRA: Jangan kirim data jika ID Tender Type kosong/tidak valid
            const rawTenderId = payment.C_POSTenderType_ID;
            if (!rawTenderId || isNaN(parseInt(rawTenderId))) {
                console.warn("Melewati baris pembayaran kosong/tidak valid.");
                continue; // Skip baris ini agar tidak mengirim data corrupt ke Gson server
            }

            const paymentPayload = {
                AD_Client_ID:       { id: parseInt(adClientId) },
                AD_Org_ID:          { id: parseInt(adOrgId) },
                C_Order_ID:         { id: parseInt(orderId) },
                PayAmt:             parseFloat(payment.PayAmt || 0), // Pastikan angka desimal valid
                TenderType:         String(payment.TenderType || "X"), // Paksa menjadi string primitive
                C_POSTenderType_ID: { id: parseInt(rawTenderId) }
            };

            console.log("Mengirim baris pembayaran aman:", JSON.stringify(paymentPayload));
            await customFetch("/models/c_pospayment", {
                method: "POST",
                body: JSON.stringify(paymentPayload),
            });
        }

        console.log("✅ Data C_POSPayment tersimpan. Menentukan aturan pembayaran final...");

        // Langkah 2: Logika State Flipping Aturan Pembayaran
        let finalPaymentRule = "M"; 
        
        // Pastikan pengecekan item array tidak null menggunakan operator opsional (?.)
        if (cleanPaymentsArray?.length === 1) {
            const singleTender = cleanPaymentsArray[0]?.TenderType; // FIX: Ambil indeks ke-0 array
            if (singleTender === "X") finalPaymentRule = "B";      // Cash
            else if (singleTender === "K") finalPaymentRule = "K"; // Credit Card
            else if (singleTender === "D") finalPaymentRule = "T"; // Bank Transfer
        }

        // Jalankan PUT untuk memperbarui PaymentRule
        await customFetch(`/models/c_order/${orderId}`, {
            method: "PUT",
            body: JSON.stringify({
                "PaymentRule": finalPaymentRule
            }),
        });

        console.log(`✅ Aturan pembayaran diset ke [${finalPaymentRule}]. Mengunci transaksi ke Complete...`);

        // Langkah 3: Eksekusi Document Action Complete kebab-case resmi
        const completedOrder = await customFetch(`/models/c_order/${orderId}`, {
            method: "PUT",
            body: JSON.stringify({
                "doc-action": "CO"
            }),
        });

        const finalDocNo = completedOrder.DocumentNo || currentOrderData.DocumentNo || orderId;
        alert(`Transaksi Lunas & Sukses!\nNomor Dokumen: ${finalDocNo}`);
        
        // Bersihkan seluruh state Kasir POS
        setIsPaymentModalOpen(false);
        setCurrentOrderData(null);
        setCart([]);

    } catch (err) {
        console.error("Proses Pembayaran POS Gagal:", err.message);
        alert("Eror saat memproses pembayaran final: " + err.message);
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

            {/* Config Bar — selalu tampil, bukan hanya development */}
            <div style={{ background: '#f0f4ff', padding: '12px 16px', borderRadius: '8px', border: '1px solid #c5d0e8', fontSize: '13px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>

                    {/* Info statis */}
                    <div style={{ display: 'flex', gap: '16px', color: '#555', flexShrink: 0 }}>
                        <span><strong>POS:</strong> {posConfig?.Name || '...'}</span>
                        <span><strong>SalesRep:</strong> {posConfig?.SalesRep_ID?.id ?? posConfig?.SalesRep_ID ?? '-'}</span>
                        <span><strong>Version:</strong> {currentVersionId
                            ? <span style={{ color: '#2e7d32' }}>{currentVersionId}</span>
                            : <span style={{ color: '#c62828' }}>Not Found</span>}
                        </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '200px' }}>
                        <label style={{ fontWeight: 'bold', whiteSpace: 'nowrap', color: '#333' }}>Customer:</label>
                        <select
                            value={selectedBPartner?.id || ''}
                            onChange={handleBPartnerChange}
                            style={{ flex: 1, padding: '5px 8px', borderRadius: '6px', border: '1px solid #bbb', fontSize: '13px', background: selectedBPartner ? '#fff' : '#fff3f3', color: '#333' }}
                        >
                            <option value="">-- Pilih Customer --</option>
                            {bPartnerList.map(bp => (
                                <option key={bp.id} value={bp.id}>{bp.name}</option>
                            ))}
                        </select>
                        {!selectedBPartner && (
                            <span style={{ color: '#c62828', fontSize: '11px', whiteSpace: 'nowrap' }}>⚠ Wajib diisi</span>
                        )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '200px' }}>
                        <label style={{ fontWeight: 'bold', whiteSpace: 'nowrap', color: '#333' }}>Price List:</label>
                        <select
                            value={selectedPriceList?.id || ''}
                            onChange={handlePriceListChange}
                            disabled={loading}
                            style={{ flex: 1, padding: '5px 8px', borderRadius: '6px', border: '1px solid #bbb', fontSize: '13px', background: '#fff', color: '#333' }}
                        >
                            <option value="">-- Pilih Price List --</option>
                            {priceListList.map(pl => (
                                <option key={pl.id} value={pl.id}>{pl.name}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

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
                            <button
                                onClick={handleCheckout}
                                disabled={isProcessingCheckout}
                                style={{ background: isProcessingCheckout ? '#aaa' : '#28a745', color: 'white', border: 'none', padding: '14px', width: '100%', borderRadius: '8px', fontWeight: 'bold', fontSize: '15px', cursor: isProcessingCheckout ? 'not-allowed' : 'pointer' }}
                            >
                                {isProcessingCheckout ? 'Memproses...' : 'PROSES BAYAR'}
                            </button>
                        </div>
                    )}
                </div>
                 {/* ─── TEMPATKAN DI SINI (BARIS PALING BAWAH SEBELUM CLOSING TAG UTAMA) ─── */}
                <PaymentModal 
                    isOpen={isPaymentModalOpen} 
                    onClose={() => setIsPaymentModalOpen(false)} 
                    totalOrderAmount={calculateTotal()} 
                    onSubmitPayment={handleCompletePOSPaymentWorkflow} 
                    customFetch={customFetch} 
                />
            </div>
        </div>
    );
};

export default POSContainer;
