import type { Config, JobsConfig } from "payload";

import { deepMergeSimple, importHandlerPath } from "payload";

import type { ImportExportPluginConfig } from "./types";

import pkg from "../package.json";
import { getCreateCollectionExportTask } from "./export/getCreateExportCollectionTask";
import { getExportCollection } from "./getExportCollection";
import { createImportHandler } from "./import/importHandler";
import { translations } from "./translations/index";

export const importExportPlugin =
    (pluginConfig: ImportExportPluginConfig) =>
    (config: Config): Config => {
        const exportCollection = getExportCollection({ config, pluginConfig });
        if (config.collections) {
            config.collections.push(exportCollection);
        } else {
            config.collections = [exportCollection];
        }

        // inject custom import export provider
        config.admin = config.admin || {};
        config.admin.components = config.admin.components || {};
        config.admin.components.providers =
            config.admin.components.providers || [];
        config.admin.components.providers.push(
            "@shopnex/import-export-plugin/rsc#ImportExportProvider"
        );

        // inject the createExport job into the config
        config.jobs =
            config.jobs ||
            ({
                tasks: [getCreateCollectionExportTask(config)],
            } as unknown as JobsConfig); // cannot type jobs config inside of plugins

        let collectionsToUpdate = config.collections;
        pluginConfig.importCollections?.forEach(
            ({ collectionSlug, columns }) => {
                const collection = config.collections?.find(
                    ({ slug }) => slug === collectionSlug
                );
                if (!collection) {
                    throw new Error(`Collection ${collectionSlug} not found`);
                }
                if (!collection.endpoints) {
                    collection.endpoints = [];
                }
                collection.endpoints?.push({
                    handler: createImportHandler(collectionSlug),
                    method: "post",
                    path: "/import",
                });
            }
        );

        const usePluginCollections =
            pluginConfig.collections && pluginConfig.collections?.length > 0;

        if (usePluginCollections) {
            collectionsToUpdate = config.collections?.filter((collection) => {
                return pluginConfig.collections?.includes(collection.slug);
            });
        }

        collectionsToUpdate.forEach((collection) => {
            if (!collection.admin) {
                collection.admin = { components: { listMenuItems: [] } };
            }
            const components = collection.admin.components || {};
            if (!components.listMenuItems) {
                components.listMenuItems = [];
            }
            if (!components.edit) {
                components.edit = {};
            }
            // TODO: remove this when we have a better way to handle this
            // if (!components.edit.SaveButton) {
            //     components.edit.SaveButton = "@shopnex/import-export-plugin/rsc#ExportSaveButton";
            // }
            components.listMenuItems.push({
                clientProps: {
                    exportCollectionSlug: exportCollection.slug,
                },
                path: "@shopnex/import-export-plugin/rsc#ExportListMenuItem",
            });
            const customColumns = pluginConfig.importCollections?.find(
                ({ collectionSlug }) => collectionSlug === collection.slug
            )?.columns;
            components.listMenuItems.push({
                clientProps: {
                    customColumns,
                },
                path: "@shopnex/import-export-plugin/rsc#ImportListMenuItem",
            });
            collection.admin.components = components;
        });

        if (!config.i18n) {
            config.i18n = {};
        }

        config.i18n.translations = deepMergeSimple(
            translations,
            config.i18n?.translations ?? {}
        );

        const incomingOnInit = config.onInit;

        config.onInit = async (payload) => {
            if (incomingOnInit) {
                await incomingOnInit(payload);
            }
            await config.custom?.syncPlugin?.(payload, {
                name: pkg.name,
                author: pkg.author,
                category: pkg.category,
                description: pkg.description,
                icon: pkg.icon,
                license: pkg.license,
                version: pkg.version,
            });
        };

        return config;
    };
