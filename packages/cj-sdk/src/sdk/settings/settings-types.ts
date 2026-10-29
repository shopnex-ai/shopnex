export interface QuotaLimit {
    quotaLimit: number;
    quotaType: number;
    quotaUrl: string;
}

export interface Setting {
    qpsLimit: number;
    quotaLimits: QuotaLimit[];
}

export interface Callback {
    productCallbackUrls: string[];
    productType: string;
}

export interface AccountSettings {
    callback: Callback;
    isSandbox: boolean;
    openEmail: string;
    openId: string;
    openName: string;
    root: string;
    setting: Setting;
}
