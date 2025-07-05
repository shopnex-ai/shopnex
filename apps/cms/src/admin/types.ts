import type {
    JsonObject,
    PayloadRequest,
    RequestContext,
    SanitizedCollectionConfig,
    TypeWithID,
} from "payload";

export type AfterChangeHook<T extends TypeWithID = any> = (args: {
    /** The collection which this hook is being run on */
    collection: SanitizedCollectionConfig;
    context: RequestContext;
    doc: T;
    /**
     * Hook operation being performed
     */
    operation: "create" | "update";
    previousDoc: T;
    req: PayloadRequest;
}) => any;

export type BeforeChangeHook<T extends TypeWithID = any> = (args: {
    /** The collection which this hook is being run on */
    collection: SanitizedCollectionConfig;
    context: RequestContext;
    data: Partial<T>;
    /**
     * Hook operation being performed
     */
    operation: "create" | "update";
    /**
     * Original document before change
     *
     * `undefined` on 'create' operation
     */
    originalDoc?: T;
    req: PayloadRequest;
}) => any;

export type FieldAccessArgs<
    TData extends TypeWithID = any,
    TSiblingData = any,
> = {
    /**
     * The data of the nearest parent block. If the field is not within a block, `blockData` will be equal to `undefined`.
     */
    blockData?: JsonObject | undefined;
    /**
     * The incoming, top-level document data used to `create` or `update` the document with.
     */
    data?: Partial<TData>;
    /**
     * The original data of the document before the `update` is applied. `doc` is undefined during the `create` operation.
     */
    doc?: TData;
    /**
     * The `id` of the current document being read or updated. `id` is undefined during the `create` operation.
     */
    id?: number | string;
    /** The `payload` object to interface with the payload API */
    req: PayloadRequest;
    /**
     * Immediately adjacent data to this field. For example, if this is a `group` field, then `siblingData` will be the other fields within the group.
     */
    siblingData?: Partial<TSiblingData>;
};
