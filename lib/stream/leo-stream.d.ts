
import { StreamUtil } from "../lib";
import { StreamUtilV2 } from "./leo-stream-v2";

declare function ExportType(config: any): (typeof StreamUtil) & (typeof StreamUtilV2);
export = ExportType;
