import type {
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
