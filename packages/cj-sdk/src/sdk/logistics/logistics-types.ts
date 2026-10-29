export interface FreightCalculateParams {
    endCountryCode: string;
    houseNumber?: string;
    iossNumber?: string;
    /** Required when shippingMode is 1 (tiktok_us, Temu, shein, ...) */
    platforms?: string[];
    products: { quantity: number; vid: string }[];
    /** 1 = platform logistics, 2 = merchant logistics */
    shippingMode?: 1 | 2;
    startCountryCode: string;
    storageIdList?: string[];
    taxId?: string;
    zip?: string;
}

export interface TrackInfo {
    deliveryDay: string;
    deliveryTime: string;
    lastMileCarrier: string;
    lastTrackNumber: string;
    logisticName?: string;
    trackingFrom: string;
    trackingNumber: string;
    trackingStatus: string;
    trackingTo: string;
}
