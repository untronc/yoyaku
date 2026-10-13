// 受け入れ試験用の Worker の入口
import { createWorker } from "../../src/worker.js";
import site from "./site.config.js";

export default createWorker(site);
