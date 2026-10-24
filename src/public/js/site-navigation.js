(function () {
  "use strict";
  import("/src/public/js/site-menu.js?v=20261008-menu").then(({ initSiteMenu }) => initSiteMenu()).catch(() => {});
  // Keep the original position in the layout when the navigation reaches the top.
  const navigation = document.querySelector("nav.site-nav");
  if (navigation) {
    const placeholder = document.createElement("div");
    placeholder.className = "site-nav-placeholder";
    placeholder.hidden = true;
    placeholder.setAttribute("aria-hidden", "true");
    navigation.before(placeholder);
    const safeProbe = document.createElement("div");
    safeProbe.style.cssText =
      "position:fixed;top:0;height:env(safe-area-inset-top,0px);padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px);visibility:hidden;pointer-events:none";
    document.body.append(safeProbe);
    function moveNavigation(toBody) {
      const focused = navigation.contains(document.activeElement)
        ? document.activeElement
        : null;
      if (toBody) document.body.prepend(navigation);
      else placeholder.after(navigation);
      focused?.focus({ preventScroll: true });
    }
    function applyBounds() {
      navigation.style.left = "0px";
      navigation.style.width = document.documentElement.clientWidth + "px";
    }
    let scheduled = false;
    function updateNavigation() {
      scheduled = false;
      if (!navigation.getClientRects().length) {
        if (navigation.classList.contains("is-stuck")) moveNavigation(false);
        placeholder.hidden = true;
        navigation.classList.remove("is-stuck");
        navigation.style.removeProperty("left");
        navigation.style.removeProperty("width");
        return;
      }
      const stuck = navigation.classList.contains("is-stuck");
      const rect = (stuck ? placeholder : navigation).getBoundingClientRect();
      const top = safeProbe.getBoundingClientRect().height;
      if (rect.top <= top && rect.width > 0) {
        if (!stuck) {
          const style = getComputedStyle(navigation);
          placeholder.style.cssText = `height:${rect.height}px;box-sizing:border-box;flex:${style.flex};grid-area:${style.gridArea};margin:${style.margin};align-self:${style.alignSelf}`;
          placeholder.hidden = false;
          applyBounds();
          navigation.classList.add("is-stuck");
          moveNavigation(true);
        } else {
          applyBounds();
        }
      } else if (stuck) {
        moveNavigation(false);
        navigation.classList.remove("is-stuck");
        navigation.style.removeProperty("left");
        navigation.style.removeProperty("width");
        placeholder.hidden = true;
      }
    }
    function scheduleNavigation() {
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(updateNavigation);
      }
    }
    document.addEventListener("scroll", scheduleNavigation, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", scheduleNavigation, { passive: true });
    const navigationObserver = new ResizeObserver(scheduleNavigation);
    navigationObserver.observe(navigation.parentElement);
    navigationObserver.observe(navigation);
    new MutationObserver(scheduleNavigation).observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    scheduleNavigation();
  }
  const footerActions =
    document.querySelector(".site-footer__utility-links") ||
    document.querySelector(".site-footer__actions") ||
    document.querySelector(".site-footer");
  if (footerActions) {
    const share = document.createElement("button");
    share.type = "button";
    share.className = "site-footer__share";
    share.textContent = "Partager Parici";
    const status = document.createElement("span");
    status.className = "site-footer__share-status";
    status.setAttribute("role", "status");
    const sharing = document.createElement("div");
    sharing.className = "site-footer__sharing";
    sharing.append(share, status);
    footerActions.closest(".site-footer").append(sharing);
    share.addEventListener("click", async () => {
      const url = new URL("/", location.origin).href;
      try {
        if (navigator.share) {
          await navigator.share({
            title: "Parici",
            text: "Découvre Paris en jouant avec Parici.",
            url,
          });
          status.textContent = "";
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(url);
          status.textContent = "Lien de Parici copié !";
        } else {
          status.textContent = `Lien à partager : ${url}`;
        }
      } catch (error) {
        if (error.name !== "AbortError")
          status.textContent = `Lien à partager : ${url}`;
      }
    });
  }
})();
