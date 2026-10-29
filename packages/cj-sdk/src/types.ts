export interface CJApiResponse<T> {
    code: number;
    data: null | T;
    message: string;
    requestId: string;
    result: boolean;
}

export interface AccessTokenResponse {
    code: number;
    data: {
        accessToken: string;
        accessTokenExpiryDate: Date | string;
        createDate: string;
        refreshToken: string;
        refreshTokenExpiryDate: Date | string;
    } | null;
    message: string;
    requestId: string;
    result: boolean;
}

export interface Variant {
    createTime: string;
    pid: string;
    variantHeight: number;
    variantImage: null | string;
    variantKey: string;
    variantLength: number;
    variantName: null | string;
    variantNameEn: null | string;
    variantProperty: null | string;
    variantSellPrice: number;
    variantSku: string;
    variantStandard: null | string;
    variantSugSellPrice: number;
    variantUnit: null | string;
    variantVolume: number;
    variantWeight: number;
    variantWidth: number;
    vid: string;
}

export interface ProductDetailResponseData {
    categoryId: string;
    categoryName: string;
    createrTime: string;
    description: string;
    entryCode: string;
    entryName: string;
    entryNameEn: string;
    listedNum: number;
    materialKey: string[];
    materialName: string[];
    materialNameEn: string[];
    packingKey: string[];
    packingName: string[];
    packingNameEn: string[];
    packingWeight: number;
    pid: string;
    productImage: string;
    productKey: string[];
    productKeyEn: string;
    productName: string[];
    productNameEn: string;
    productSku: string;
    productType: string;
    productUnit: string;
    productWeight: number;
    sellPrice: number;
    sourceFrom: number;
    status: string;
    suggestSellPrice: string;
    supplierId: string;
    supplierName: string;
    variants: Variant[];
}
