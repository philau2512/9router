// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  saveRequestDetail,
  getRequestDetails,
  getRequestDetailsList,
  getRequestDetailById,
  getDistinctProviders,
} from "@/lib/db/index.js";
