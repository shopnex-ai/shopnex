import { closeClickFiles } from "./close-click";
import { customBadgeFiles } from "./custom-badge";
import { customHandlersFiles } from "./custom-handlers";
import { customPrevNextFiles } from "./custom-prev-next";
import { customStylesFiles } from "./custom-styles";
import { defaultFiles } from "./defaults";
import { disableDotsNavFiles } from "./disable-dots-nav";
import { disableInteractionFiles } from "./disable-interaction";
import { disableKeyboardFiles } from "./disable-keyboard";
import { maskClickFiles } from "./mask-click";
import { paddingFiles } from "./padding";
import { rtlFiles } from "./rtl";
import { scrollLockFiles } from "./scroll-lock";
import { scrollSmoothFiles } from "./scroll-smooth";
import { startAtFiles } from "./start-at";
import { toggleNavPartsFiles } from "./toggle-nav-parts";

const filesByDemo = {
    "close-click": closeClickFiles,
    "custom-badge": customBadgeFiles,
    "custom-handlers": customHandlersFiles,
    "custom-prev-next": customPrevNextFiles,
    "custom-styles": customStylesFiles,
    "disable-dots-nav": disableDotsNavFiles,
    "disable-interaction": disableInteractionFiles,
    "disable-keyboard": disableKeyboardFiles,
    "mask-click": maskClickFiles,
    padding: paddingFiles,
    rtl: rtlFiles,
    "scroll-lock": scrollLockFiles,
    "scroll-smooth": scrollSmoothFiles,
    "start-at": startAtFiles,
    "toggle-nav-parts": toggleNavPartsFiles,
};

export function configFiles(demoId: string) {
    const files =
        demoId && filesByDemo[demoId] ? filesByDemo[demoId] : defaultFiles;

    return files;
}
