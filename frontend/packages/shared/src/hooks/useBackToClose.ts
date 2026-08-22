import { useEffect, useRef } from "react";

const POPUP_FLAG = "__wlt_popup";

/**
 * 硬件/浏览器返回键关闭弹层（antd-mobile Popup 默认不响应返回键）。
 *
 * 原理：弹层打开时压入一条带标记的历史记录；返回键消费掉该记录（popstate 触发、且栈顶
 * 不再是我们的标记）→ 关闭弹层，页面不退出。
 *
 * 防御性设计（修复“点击会自动返回”类回归）：
 * 1. 只认「我们自己压入的条目被弹出」这一种 popstate：若弹层打开期间发生了与本次弹层无关的
 *    popstate（路由自身的 POP、其它弹层收尾时异步 history.back()、原生相机/文件选择器导致的
 *    历史事件），此时栈顶仍是我们的标记 → 直接忽略，绝不误调 onClose。
 * 2. onClose 仅在 URL 回到压入前的地址时触发：若返回时 URL 已变（说明弹层之上已有路由导航，
 *    用户实际在别处），交给路由处理，避免 onClose 里的 navigate 造成二次跳转。
 * 3. cleanup 的 history.back() 是异步遍历，只在我们标记仍在栈顶且 URL 未变时才回退自己的条目；
 *    否则不回退（避免竞态弹出路由条目）。
 */
export function useBackToClose(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const urlRef = useRef("");

  useEffect(() => {
    if (!open) return;
    urlRef.current = window.location.href;
    window.history.pushState({ [POPUP_FLAG]: true }, "");

    const onPop = () => {
      const current = window.history.state;
      // 我们的标记仍在栈顶 → 本次 pop 不是消费我们的条目（路由/其它来源），忽略
      if (current && current[POPUP_FLAG] === true) return;
      // 我们的条目被弹出：仅当 URL 回到压入前的地址才关闭弹层（否则是路由层面的返回）
      if (window.location.href === urlRef.current) {
        onCloseRef.current();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // 仅当我们的标记仍在栈顶、且 URL 未变时才回退自己的条目；否则条目已被消费或被导航覆盖
      const current = window.history.state;
      if (current && current[POPUP_FLAG] === true && window.location.href === urlRef.current) {
        window.history.back();
      }
    };
  }, [open]);
}
