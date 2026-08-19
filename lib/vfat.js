export function vfatPoolIdentity(farm) {
  const chainId = Number(farm?.chainId || farm?.pool?.chainId || 0);
  const farmAddress = String(farm?.address || '').toLowerCase();
  const poolAddress = String(farm?.pool?.address || farmAddress).toLowerCase();
  const poolId = String(farm?.pool?.poolId || '').toLowerCase();
  const poolKey = farm?.type === 'UNISWAP_V4' && poolId ? poolId : poolAddress;
  const baseId = `vfat:${chainId}:${poolAddress}`;
  return { id: farm?.type === 'UNISWAP_V4' && poolId ? `${baseId}:${poolId}` : baseId, poolId: poolId || null, poolKey };
}
