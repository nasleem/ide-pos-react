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
    
    // State tambahan untuk memantau status checkout di UI
    const [isProcessingCheckout, setIsProcessingCheckout] = useState(false);

    const API_BASE    = "/api/v1";
    const debounceRef = useRef(null);
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

    // ─── 1. Init (Mengambil data C_POS lengkap dengan Tenant & Org) ───────────
    useEffect(() => {
        const initPOS = async () => {
            try {
                const loginUserId = localStorage.getItem("AD_User_ID");
                if (!loginUserId) { alert("Sesi user tidak ditemukan."); setLoading(false); return; }
                
                // Ditambahkan select parameter kritis: AD_Client_ID, AD_Org_ID, M_Warehouse_ID, C_DocType_ID, dll.
                const selectFields = "C_POS_ID,Name,AD_Client_ID,AD_Org_ID,M_Warehouse_ID,M_PriceList_ID,C_DocType_ID,C_BPartner_ID,SalesRep_ID";
                const data = await customFetch(
                    `/models/c_pos?$filter=SalesRep_ID eq ${loginUserId}&$select=${selectFields}&$expand=SalesRep_ID($select=Name)`
                );
                
                if (data?.records?.length > 0) {
                    const terminalConfig = data.records[0];
                    setPosConfig(terminalConfig);
                    
                    const priceListId = terminalConfig.M_PriceList_ID?.id ?? terminalConfig.M_PriceList_ID;
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

    // ─── 2. Fetch products (Logika bawaan dipertahankan) ──────────────────────
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
                
                const defaultUOM = {
                    id:           p.C_UOM_ID?.id ?? p.C_UOM_ID,
                    name:         p.C_UOM_ID?.Name || p.C_UOM_ID?.identifier || 'EA',
                    multiplyRate: 1,
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

    // ─── 3. Fetch UOM options (Kerangka dipertahankan) ────────────────────────
    const fetchUOMOptions = async (product) => {
        // ... (Logika fetchUOMOptions bawaan Anda tetap di sini)
    };


    // ─── 4. PARSER: Konversi State Cart Menjadi Payload iDempiere REST ────────
    const preparePayloadForIdempiere = () => {
        if (!posConfig) throw new Error("Konfigurasi C_POS belum dimuat.");

        // Ekstraksi ID bersih dari relasi objek iDempiere REST
        const adClientId   = posConfig.AD_Client_ID?.id ?? posConfig.AD_Client_ID;
        const adOrgId      = posConfig.AD_Org_ID?.id ?? posConfig.AD_Org_ID;
        const bPartnerId   = posConfig.C_BPartner_ID?.id ?? posConfig.C_BPartner_ID;
        const warehouseId  = posConfig.M_Warehouse_ID?.id ?? posConfig.M_Warehouse_ID;
        const docTypeId    = posConfig.C_DocType_ID?.id ?? posConfig.C_DocType_ID;
        const priceListId  = posConfig.M_PriceList_ID?.id ?? posConfig.M_PriceList_ID;
        const salesRepId   = posConfig.SalesRep_ID?.id ?? posConfig.SalesRep_ID;

        // Pemetaan Baris Item (Lines)
        const formattedLines = cart.map((item) => ({
            M_Product_ID: item.M_Product_ID,
            QtyOrdered:   item.QtyOrdered,
            PriceActual:  item.PriceActual, // Menggunakan harga final setelah diskon/UOM rate
            C_UOM_ID:     item.currentUOM?.id ?? item.defaultUOM?.id // Memastikan satuan terikat aman
        }));

        // Gabungkan seluruh parameter ke dalam format Composite Layout Header-Lines
        return {
            AD_Client_ID:       adClientId,
            AD_Org_ID:          adOrgId,
            C_DocTypeTarget_ID: docTypeId,      // Menggunakan tipe dokumen bawaan C_POS
            C_BPartner_ID:      bPartnerId,      // Default Customer Tunai dari C_POS
            M_Warehouse_ID:     warehouseId,
            M_PriceList_ID:     priceListId,
            SalesRep_ID:        salesRepId,
            PaymentRule:        "M",             // 'M' = Mixed POS / Cash (Aman untuk Transaksi Kasir)
            lines:              formattedLines
        };
    };


    // ─── 5. CHECKOUT: Eksekusi Fase 2 (POST) & Fase 3 (DocAction CO) ──────────
    const handleCheckoutProcess = async () => {
        if (cart.length === 0) { alert("Keranjang masih kosong!"); return; }
        
        setIsProcessingCheckout(true);
        try {
            // Skenario Pembuatan Payload Transaksi
            const orderPayload = preparePayloadForIdempiere();
            
            // FASE 2: Simpan Transaksi Baru sebagai Draft (POST)
            console.log("Mengirim Order Draft ke iDempiere...", orderPayload);
            const createdOrder = await customFetch("/models/c_order", {
                method: "POST",
                body: JSON.stringify(orderPayload)
            });

            // Ambil ID Order yang sukses di-generate oleh database ERP
            const orderId = createdOrder.id || createdOrder.C_Order_ID;
            if (!orderId) throw new Error("Gagal mengambil C_Order_ID dari server.");

            // FASE 3: Eksekusi Penyelesaian Dokumen / Transaksi Lunas (DocAction)
            console.log(`Menyelesaikan transaksi untuk Order ID: ${orderId} (DocAction CO)...`);
            const docActionResponse = await customFetch(`/models/c_order/${orderId}/docaction`, {
                method: "PUT", // Gunakan POST atau PUT sesuai spesifikasi plugin REST Anda
                body: JSON.stringify({
                    docAction: "CO" // CO = Complete
                })
            });

            // Validasi Logika Bisnis Internal iDempiere (Contoh: Validasi Stok/Kredit)
            if (docActionResponse.isError || docActionResponse.status === "Error") {
                throw new Error(docActionResponse.message || "Aksi dokumen (Complete) ditolak sistem iDempiere.");
            }

            alert(`Transaksi Berhasil! Nomor Dokumen: ${createdOrder.DocumentNo || orderId}`);
            
            // Bersihkan Keranjang belanja setelah sukses lunas
            setCart([]); 
            
        } catch (err) {
            console.error("Proses POS Checkout Gagal:", err.message);
            alert("Checkout Gagal: " + err.message);
        } finally {
            setIsProcessingCheckout(false);
        }
    };

    return (
        <div className="pos-container">
            {/* Bagian Komponen Tampilan Kasir Anda */}
            {/* ... */}
            <button 
                onClick={handleCheckoutProcess} 
                disabled={isProcessingCheckout || loading}
                className="btn-checkout"
            >
                {isProcessingCheckout ? "Memproses Pembayaran..." : "Bayar & Cetak Struk"}
            </button>
        </div>
    );
};

export default POSContainer;
