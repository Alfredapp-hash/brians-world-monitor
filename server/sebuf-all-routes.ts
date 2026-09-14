/**
 * All sebuf domain routes in one list.
 *
 * Used by Vite's local API plugin (raw router + CORS) and by the Netlify
 * production dispatcher (createDomainGateway). Keep this as the single
 * assembly point so a domain cannot be live on Vercel and missing on Netlify.
 */
import { createDomainGateway, serverOptions } from './gateway';
import { createRouter, type Router, type RouteDescriptor } from './router';

export { SEBUF_PATH_RE, V1_ALIASES, isSebufApiPath, rewriteSebufAlias } from './sebuf-paths';

import { createAviationServiceRoutes } from '../src/generated/server/worldmonitor/aviation/v1/service_server';
import { aviationHandler } from './worldmonitor/aviation/v1/handler';
import { createBatchServiceRoutes } from '../src/generated/server/worldmonitor/batch/v1/service_server';
import { batchHandler } from './worldmonitor/batch/v1/handler';
import { createClimateServiceRoutes } from '../src/generated/server/worldmonitor/climate/v1/service_server';
import { climateHandler } from './worldmonitor/climate/v1/handler';
import { createConflictServiceRoutes } from '../src/generated/server/worldmonitor/conflict/v1/service_server';
import { conflictHandler } from './worldmonitor/conflict/v1/handler';
import { createConsumerPricesServiceRoutes } from '../src/generated/server/worldmonitor/consumer_prices/v1/service_server';
import { consumerPricesHandler } from './worldmonitor/consumer-prices/v1/handler';
import { createCyberServiceRoutes } from '../src/generated/server/worldmonitor/cyber/v1/service_server';
import { cyberHandler } from './worldmonitor/cyber/v1/handler';
import { createDisplacementServiceRoutes } from '../src/generated/server/worldmonitor/displacement/v1/service_server';
import { displacementHandler } from './worldmonitor/displacement/v1/handler';
import { createEconomicServiceRoutes } from '../src/generated/server/worldmonitor/economic/v1/service_server';
import { economicHandler } from './worldmonitor/economic/v1/handler';
import { createForecastServiceRoutes } from '../src/generated/server/worldmonitor/forecast/v1/service_server';
import { forecastHandler } from './worldmonitor/forecast/v1/handler';
import { createGivingServiceRoutes } from '../src/generated/server/worldmonitor/giving/v1/service_server';
import { givingHandler } from './worldmonitor/giving/v1/handler';
import { createHealthServiceRoutes } from '../src/generated/server/worldmonitor/health/v1/service_server';
import { healthHandler } from './worldmonitor/health/v1/handler';
import { createImageryServiceRoutes } from '../src/generated/server/worldmonitor/imagery/v1/service_server';
import { imageryHandler } from './worldmonitor/imagery/v1/handler';
import { createInfrastructureServiceRoutes } from '../src/generated/server/worldmonitor/infrastructure/v1/service_server';
import { infrastructureHandler } from './worldmonitor/infrastructure/v1/handler';
import { createIntelligenceServiceRoutes } from '../src/generated/server/worldmonitor/intelligence/v1/service_server';
import { intelligenceHandler } from './worldmonitor/intelligence/v1/handler';
import { createLeadsServiceRoutes } from '../src/generated/server/worldmonitor/leads/v1/service_server';
import { leadsHandler } from './worldmonitor/leads/v1/handler';
import { createMaritimeServiceRoutes } from '../src/generated/server/worldmonitor/maritime/v1/service_server';
import { maritimeHandler } from './worldmonitor/maritime/v1/handler';
import { createMarketServiceRoutes } from '../src/generated/server/worldmonitor/market/v1/service_server';
import { marketHandler } from './worldmonitor/market/v1/handler';
import { createMilitaryServiceRoutes } from '../src/generated/server/worldmonitor/military/v1/service_server';
import { militaryHandler } from './worldmonitor/military/v1/handler';
import { createNaturalServiceRoutes } from '../src/generated/server/worldmonitor/natural/v1/service_server';
import { naturalHandler } from './worldmonitor/natural/v1/handler';
import { createNewsServiceRoutes } from '../src/generated/server/worldmonitor/news/v1/service_server';
import { newsHandler } from './worldmonitor/news/v1/handler';
import { createPositiveEventsServiceRoutes } from '../src/generated/server/worldmonitor/positive_events/v1/service_server';
import { positiveEventsHandler } from './worldmonitor/positive-events/v1/handler';
import { createPredictionServiceRoutes } from '../src/generated/server/worldmonitor/prediction/v1/service_server';
import { predictionHandler } from './worldmonitor/prediction/v1/handler';
import { createRadiationServiceRoutes } from '../src/generated/server/worldmonitor/radiation/v1/service_server';
import { radiationHandler } from './worldmonitor/radiation/v1/handler';
import { createResearchServiceRoutes } from '../src/generated/server/worldmonitor/research/v1/service_server';
import { researchHandler } from './worldmonitor/research/v1/handler';
import { createResilienceServiceRoutes } from '../src/generated/server/worldmonitor/resilience/v1/service_server';
import { resilienceHandler } from './worldmonitor/resilience/v1/handler';
import { createSanctionsServiceRoutes } from '../src/generated/server/worldmonitor/sanctions/v1/service_server';
import { sanctionsHandler } from './worldmonitor/sanctions/v1/handler';
import { createScenarioServiceRoutes } from '../src/generated/server/worldmonitor/scenario/v1/service_server';
import { scenarioHandler } from './worldmonitor/scenario/v1/handler';
import { createSeismologyServiceRoutes } from '../src/generated/server/worldmonitor/seismology/v1/service_server';
import { seismologyHandler } from './worldmonitor/seismology/v1/handler';
import { createShippingV2ServiceRoutes } from '../src/generated/server/worldmonitor/shipping/v2/service_server';
import { shippingV2Handler } from './worldmonitor/shipping/v2/handler';
import { createSupplyChainServiceRoutes } from '../src/generated/server/worldmonitor/supply_chain/v1/service_server';
import { supplyChainHandler } from './worldmonitor/supply-chain/v1/handler';
import { createThermalServiceRoutes } from '../src/generated/server/worldmonitor/thermal/v1/service_server';
import { thermalHandler } from './worldmonitor/thermal/v1/handler';
import { createTradeServiceRoutes } from '../src/generated/server/worldmonitor/trade/v1/service_server';
import { tradeHandler } from './worldmonitor/trade/v1/handler';
import { createUnrestServiceRoutes } from '../src/generated/server/worldmonitor/unrest/v1/service_server';
import { unrestHandler } from './worldmonitor/unrest/v1/handler';
import { createWebcamServiceRoutes } from '../src/generated/server/worldmonitor/webcam/v1/service_server';
import { webcamHandler } from './worldmonitor/webcam/v1/handler';
import { createWildfireServiceRoutes } from '../src/generated/server/worldmonitor/wildfire/v1/service_server';
import { wildfireHandler } from './worldmonitor/wildfire/v1/handler';

export function loadSebufRoutes(): RouteDescriptor[] {
  return [
    ...createSeismologyServiceRoutes(seismologyHandler, serverOptions),
    ...createWildfireServiceRoutes(wildfireHandler, serverOptions),
    ...createClimateServiceRoutes(climateHandler, serverOptions),
    ...createPredictionServiceRoutes(predictionHandler, serverOptions),
    ...createDisplacementServiceRoutes(displacementHandler, serverOptions),
    ...createAviationServiceRoutes(aviationHandler, serverOptions),
    ...createResearchServiceRoutes(researchHandler, serverOptions),
    ...createUnrestServiceRoutes(unrestHandler, serverOptions),
    ...createConflictServiceRoutes(conflictHandler, serverOptions),
    ...createMaritimeServiceRoutes(maritimeHandler, serverOptions),
    ...createCyberServiceRoutes(cyberHandler, serverOptions),
    ...createEconomicServiceRoutes(economicHandler, serverOptions),
    ...createInfrastructureServiceRoutes(infrastructureHandler, serverOptions),
    ...createMarketServiceRoutes(marketHandler, serverOptions),
    ...createNewsServiceRoutes(newsHandler, serverOptions),
    ...createIntelligenceServiceRoutes(intelligenceHandler, serverOptions),
    ...createMilitaryServiceRoutes(militaryHandler, serverOptions),
    ...createPositiveEventsServiceRoutes(positiveEventsHandler, serverOptions),
    ...createGivingServiceRoutes(givingHandler, serverOptions),
    ...createTradeServiceRoutes(tradeHandler, serverOptions),
    ...createSupplyChainServiceRoutes(supplyChainHandler, serverOptions),
    ...createNaturalServiceRoutes(naturalHandler, serverOptions),
    ...createResilienceServiceRoutes(resilienceHandler, serverOptions),
    ...createLeadsServiceRoutes(leadsHandler, serverOptions),
    ...createScenarioServiceRoutes(scenarioHandler, serverOptions),
    ...createShippingV2ServiceRoutes(shippingV2Handler, serverOptions),
    ...createWebcamServiceRoutes(webcamHandler, serverOptions),
    ...createForecastServiceRoutes(forecastHandler, serverOptions),
    ...createHealthServiceRoutes(healthHandler, serverOptions),
    ...createImageryServiceRoutes(imageryHandler, serverOptions),
    ...createRadiationServiceRoutes(radiationHandler, serverOptions),
    ...createSanctionsServiceRoutes(sanctionsHandler, serverOptions),
    ...createThermalServiceRoutes(thermalHandler, serverOptions),
    ...createBatchServiceRoutes(batchHandler, serverOptions),
    ...createConsumerPricesServiceRoutes(consumerPricesHandler, serverOptions),
  ];
}

export function createSebufRouter(): Router {
  return createRouter(loadSebufRoutes());
}

export function createSebufGateway(): (req: Request) => Promise<Response> {
  return createDomainGateway(loadSebufRoutes());
}
