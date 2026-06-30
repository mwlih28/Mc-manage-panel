-- Prevents two Allocation rows for the same node+port. Run a cleanup pass
-- first if this fails with a uniqueness violation — it means duplicate
-- (nodeId, port) rows already exist from the race condition this fixes.
CREATE UNIQUE INDEX "Allocation_nodeId_port_key" ON "Allocation"("nodeId", "port");
