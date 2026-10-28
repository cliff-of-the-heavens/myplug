import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";

export default [
  // Public storefront (anyone can browse)
  index("routes/home.tsx"),
  route("search", "routes/search.tsx"),
  route("p/:id", "routes/product.tsx"),
  route("s/:slug", "routes/store.tsx"),
  route("s/:slug/gift", "routes/store.gift.tsx"),
  route("gift/:code", "routes/gift.tsx"),
  route("cart", "routes/cart.tsx"),
  route("cart/checkout/:storeId", "routes/cart.checkout.tsx"),
  route("safety", "routes/safety.tsx"),
  route("advertise", "routes/advertise.tsx"),
  route("ad-upload/:token", "routes/ad-upload.tsx"),
  route("terms", "routes/terms.tsx"),
  route("notifications", "routes/notifications.tsx"),

  // Transport: rides, moves, parcels and car hire from registered couriers
  route("transport", "routes/transport.tsx"),
  route("transport/new", "routes/transport.new.tsx"),
  route("transport/jobs/:id", "routes/transport.job.tsx"),
  route("transport/cars/:id", "routes/transport.car.tsx"),

  // Auth
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  route("forgot-password", "routes/forgot-password.tsx"),
  route("reset-password", "routes/reset-password.tsx"),
  route("account/password", "routes/account.password.tsx"),
  route("logout", "routes/logout.tsx"),
  route("auth/:provider", "routes/auth.provider.ts"),
  route("auth/:provider/callback", "routes/auth.callback.ts"),

  // Customer
  route("account/orders", "routes/account.orders.tsx"),
  route("account/orders/:id", "routes/account.order.tsx"),
  route("account/alerts", "routes/account.alerts.tsx"),
  route("account/plans", "routes/account.plans.tsx"),
  route("account/addresses", "routes/account.addresses.tsx"),
  route("account/library", "routes/account.library.tsx"),
  route("account/favourites", "routes/account.favourites.tsx"),
  route("account/coupons", "routes/account.coupons.tsx"),
  route("account/ad-free", "routes/account.ad-free.tsx"),
  route("account/offers", "routes/account.offers.tsx"),
  route("account/transport", "routes/account.transport.tsx"),

  // Couriers
  route("courier", "routes/courier.tsx"),
  route("courier/profile", "routes/courier.profile.tsx"),
  route("courier/reviews", "routes/courier.reviews.tsx"),
  route("courier/transport", "routes/courier.transport.tsx"),
  route("courier/transport/:id", "routes/courier.transport-job.tsx"),
  route("courier/cars", "routes/courier.cars.tsx"),
  route("courier/cars/new", "routes/courier.car-form.tsx", { id: "courier-car-new" }),
  route("courier/cars/:id", "routes/courier.car-form.tsx", { id: "courier-car-edit" }),
  route("alerts/unsubscribe", "routes/alerts.unsubscribe.tsx"),

  // Image requests board + messaging (customers and merchants)
  route("requests", "routes/requests.tsx"),
  route("requests/new", "routes/requests.new.tsx"),
  route("requests/:id", "routes/requests.detail.tsx"),
  route("messages", "routes/messages.tsx", [
    index("routes/messages.index.tsx"),
    route(":id", "routes/messages.thread.tsx"),
  ]),

  // Merchant dashboard (approved stores only; others see the approval status page)
  ...prefix("sell", [
    route("pending", "routes/sell.pending.tsx"),
    route("business", "routes/sell.business.tsx"), // pending merchants can upload licences too
    layout("routes/sell.layout.tsx", [
      index("routes/sell.index.tsx"),
      route("products", "routes/sell.products.tsx"),
      route("products/new", "routes/sell.product-form.tsx", { id: "sell-product-new" }),
      route("products/:id", "routes/sell.product-form.tsx", { id: "sell-product-edit" }),
      route("orders", "routes/sell.orders.tsx"),
      route("orders/:id", "routes/sell.order.tsx"),
      route("promote", "routes/sell.promote.tsx"),
      route("deals", "routes/sell.deals.tsx"),
      route("coupons", "routes/sell.coupons.tsx"),
      route("reviews", "routes/sell.reviews.tsx"),
      route("offers", "routes/sell.offers.tsx"),
      route("plan", "routes/sell.plan.tsx"),
      route("alerts", "routes/sell.alerts.tsx"),
      route("plans", "routes/sell.plans.tsx"),
      route("store", "routes/sell.store.tsx"),
    ]),
  ]),

  // Admin portal
  ...prefix("admin", [
    layout("routes/admin.layout.tsx", [
      index("routes/admin.index.tsx"),
      route("merchants", "routes/admin.merchants.tsx"),
      route("couriers", "routes/admin.couriers.tsx"),
      route("customers", "routes/admin.customers.tsx"),
      route("users/:id", "routes/admin.user.tsx"),
      route("ads", "routes/admin.ads.tsx"),
      route("ads/settings", "routes/admin.ad-settings.tsx"),
      route("alerts", "routes/admin.alerts.tsx"),
      route("system", "routes/admin.system.tsx"),
      route("moderation", "routes/admin.moderation.tsx"),
      route("analytics", "routes/admin.analytics.tsx"),
      route("reviews", "routes/admin.reviews.tsx"),
      route("bands", "routes/admin.bands.tsx"),
      route("banners", "routes/admin.banners.tsx"),
      route("banners/settings", "routes/admin.banner-settings.tsx"),
      route("banners/:id", "routes/admin.banner.tsx"),
    ]),
    route("alerts/:id/preview", "routes/admin.alert-preview.ts"),
  ]),

  // Resource routes
  route("api/report", "routes/api.report.ts"),
  route("api/subscribe", "routes/api.subscribe.ts"),
  route("api/cron/alerts", "routes/api.cron.alerts.ts"),
  route("api/cron/daily", "routes/api.cron.daily.ts"),
  route("api/upload", "routes/api.upload.ts"),
  route("api/favourite", "routes/api.favourite.ts"),
  route("api/vote", "routes/api.vote.ts"),
  route("api/cart", "routes/api.cart.ts"),
  route("api/media-upload", "routes/api.media-upload.ts"),
  route("files/:type/:id", "routes/files.ts"),
  route("ad/:id", "routes/ad.ts"),
  route("api/t", "routes/api.t.ts"),
  route("media/:grantId", "routes/media.ts"),
] satisfies RouteConfig;
