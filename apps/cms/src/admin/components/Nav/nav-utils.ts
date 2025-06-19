import type { EntityType, NavGroupType } from "@payloadcms/ui/shared";
import type { StaticLabel } from "payload";

type IEntityType = {
    label: StaticLabel;
    slug: string;
    type: EntityType;
};

export const getActiveGroup = (pathname: string, adminRoute: string) =>
    pathname
        .replace(adminRoute, "")
        .replace("/collections", "")
        .replace("/globals", "")
        .split("/")[1];

export const getSortedGroups = (groups: NavGroupType[]) =>
    groups.sort((a, b) =>
        a.label === "Settings" ? 1 : b.label === "Settings" ? -1 : 0
    );

export const getFilteredEntities = (
    entities: IEntityType[],
    groupSlug: string
) => {
    return entities.filter((el) => el.slug !== groupSlug);
};
