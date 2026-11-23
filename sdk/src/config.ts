import { Connection, PublicKey, type Commitment } from "@solana/web3.js";
import { BLIND_DEAL_PROGRAM_ID, CLUSTERS, type ClusterName } from "./ids.js";

export interface BlindDealConfig {
  programId?: PublicKey | string;
  cluster?: ClusterName | (string & {});
  connection?: Connection;
  commitment?: Commitment;
}

export function clusterUrl(cluster: ClusterName | (string & {}) = "devnet"): string {
  if (cluster in CLUSTERS) return CLUSTERS[cluster as ClusterName];
  if (cluster.startsWith("http://") || cluster.startsWith("https://")) return cluster;
  throw new Error(`unknown cluster "${cluster}"`);
}

export function programIdOf(config?: BlindDealConfig): PublicKey {
  if (!config?.programId) return BLIND_DEAL_PROGRAM_ID;
  return config.programId instanceof PublicKey ? config.programId : new PublicKey(config.programId);
}

export function connectionFrom(config?: BlindDealConfig): Connection {
  if (config?.connection) return config.connection;
  return new Connection(clusterUrl(config?.cluster ?? "devnet"), config?.commitment ?? "confirmed");
}
