import { appConfig } from '../config.js';
import type { HeroMarket } from '../dashboard-types.js';
import type { Order } from './model.js';

export const isTikTok = (order: Order): boolean => /tiktok/i.test(order.channel ?? '') || order.lines.some(line => appConfig.shopify.tiktokOrderOnlyProductIds.some(id => line.productId === `gid://shopify/Product/${id}`));
export const orderInMarket = (order: Order, market: HeroMarket): boolean => market === 'all' || !isTikTok(order) && order.market.toLowerCase() === market;
