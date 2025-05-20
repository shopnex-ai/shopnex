"use client";

import type { NavGroupType } from "@payloadcms/ui/shared";

import { getTranslation } from "@payloadcms/translations";
import { Link, useConfig, useTranslation } from "@payloadcms/ui";
import { EntityType, formatAdminURL } from "@payloadcms/ui/shared";
import { Home } from "lucide-react";
import { usePathname } from "next/navigation";

import { getNavIcon } from "./get-nav-icon";
import {
    getActiveGroup,
    getFilteredEntities,
    getSortedGroups,
} from "./nav-utils";

type NavProps = {
    groups: NavGroupType[];
};

const baseClass = "nav";

export const NavClient = ({ groups }: NavProps) => {
    const pathname = usePathname();
    const {
        config: {
            routes: { admin: adminRoute },
        },
    } = useConfig();
    const { i18n } = useTranslation();

    const activeGroup = getActiveGroup(pathname, adminRoute);
    const sortedGroups = getSortedGroups(groups);

    return (
        <div className="menu">
            <li className="group">
                <Link
                    className={`${baseClass}__link group-toggle`}
                    href={adminRoute}
                >
                    <Home size={16} />
                    {"Home"}
                </Link>
            </li>
            {sortedGroups.map(({ entities, label: groupLabel }, key) => {
                const groupSlug = groupLabel.toLowerCase();
                const Icon = getNavIcon(groupSlug as any);
                const selectedGroup =
                    entities.find(
                        (el) =>
                            el.slug === groupSlug ||
                            (el.label as string)?.toLowerCase?.() === groupSlug
                    ) || entities[0];
                const isActiveGroup = entities.find(
                    (el) => el.slug === activeGroup
                );
                const filteredEntities = getFilteredEntities(
                    entities,
                    selectedGroup.slug
                );

                return (
                    <li className="group" key={key}>
                        <Link
                            className={`${baseClass}__link group-toggle`}
                            href={formatAdminURL({
                                adminRoute,
                                path: `/${selectedGroup.type === EntityType.collection ? "collections" : "globals"}/${selectedGroup?.slug}`,
                            })}
                        >
                            {Icon && <Icon size={16} />}
                            {getTranslation(groupLabel, i18n)}
                        </Link>
                        {isActiveGroup &&
                            filteredEntities.map(({ slug, type, label }) => {
                                let href: null | string = null;
                                if (type === EntityType.collection) {
                                    href = formatAdminURL({
                                        adminRoute,
                                        path: `/collections/${slug}`,
                                    });
                                } else if (type === EntityType.global) {
                                    href = formatAdminURL({
                                        adminRoute,
                                        path: `/globals/${slug}`,
                                    });
                                }
                                return (
                                    <Link
                                        className={`${baseClass}__link sub-group-list`}
                                        href={href || ""}
                                        key={slug}
                                    >
                                        {getTranslation(label, i18n)}
                                    </Link>
                                );
                            })}
                    </li>
                );
            })}
        </div>
    );
};
