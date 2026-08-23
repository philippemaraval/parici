"use strict";

const domains = Object.freeze({
  administration: ["/api/admin", "/api/analytics"],
  auth: ["/api/register", "/api/login", "/api/session", "/api/password"],
  daily: ["/api/daily"],
  notifications: ["/api/notifications"],
  profiles: ["/api/profile", "/api/referrals"],
  scores: ["/api/scores", "/api/leaderboards", "/api/friend-challenges"],
});

function ownsPath(domain, pathname) {
  return (domains[domain] || []).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

module.exports = { domains, ownsPath };
