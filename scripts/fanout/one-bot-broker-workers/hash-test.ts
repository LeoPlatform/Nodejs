
import bigInt from "big-integer";

import { createHash } from "crypto";



let partitionData = (74047769).toString();
let md5 = createHash("md5").update(partitionData).digest("hex");
let hash = bigInt(md5, 16);
console.log(partitionData, md5, hash.toString(10));


