/** task 模块：发布任务弹窗（需求 2）——标签页（Tabs）双任务类型。
 *  · 设备任务标签：直接嵌入 device 模块的设备维修任务创建表单（DeviceTaskForm）；
 *  · 线缆任务标签：直接嵌入 cable 模块的线缆故障上报表单（CableFaultForm），
 *    提交后自动生成关联该故障的线缆维修任务；
 *  · 两表单实例独立互不干扰；提交成功关闭弹窗并跳转任务列表提示成功。 */
import { lazy, Suspense, useState } from "react";
import { useNavigate } from "react-router";
import { App, Modal, Skeleton, Tabs } from "antd";

import { useAuthStore } from "@wlt/shared";

import { taskApi } from "./api";

// 跨模块表单懒加载：独立 chunk，避免看板/列表首屏拉入地图与设备模块代码
const DeviceTaskForm = lazy(() => import("../device/DeviceTaskForm").then((m) => ({ default: m.DeviceTaskForm })));
const CableFaultForm = lazy(() => import("../cable/CableFaultForm").then((m) => ({ default: m.CableFaultForm })));

export function PublishTaskModal({ open, onClose }: {
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const moduleEnabled = useAuthStore((s) => s.moduleEnabled);
  const cableEnabled = moduleEnabled("cable");
  const deviceEnabled = moduleEnabled("device");
  const [activeKey, setActiveKey] = useState("device");

  if (!cableEnabled && !deviceEnabled) {
    return null; // 无业务数据入口（正常情况下任务管理启用门禁已保证至少其一）
  }

  /** 设备任务发布成功 → 关闭 + 跳转任务列表。 */
  const onDeviceCreated = () => {
    onClose();
    navigate("/task/list");
  };

  /** 线缆故障上报成功 → 自动生成关联该故障的维修任务 → 关闭 + 跳转任务列表。 */
  const onFaultSubmitted = async (faultId: number) => {
    try {
      await taskApi.create({
        fault_id: faultId,
        title: `线缆故障维修 #${faultId}`.slice(0, 100),
        description: "",
        priority: 1,
      });
      message.success(`线缆任务已生成并关联故障 #${faultId}，请在任务列表中派发`);
    } catch (e) {
      // 故障已上报成功；任务创建失败（如该故障已有未完结任务）→ 提示但不阻断
      message.warning(e instanceof Error
        ? `故障 #${faultId} 已上报；自动生成任务未成功：${e.message}`
        : `故障 #${faultId} 已上报；自动生成任务未成功`, 5);
    }
    onClose();
    navigate("/task/list");
  };

  const fallback = <div style={{ padding: 24 }}><Skeleton active /></div>;

  return (
    <Modal open={open} onCancel={onClose} title="发布任务" width={640} destroyOnHidden footer={null}>
      <Tabs
        activeKey={deviceEnabled ? activeKey : "cable"}
        onChange={setActiveKey}
        destroyOnHidden={false}
        items={[
          ...(deviceEnabled ? [{
            key: "device",
            label: "设备任务",
            children: (
              <Suspense fallback={fallback}>
                <DeviceTaskForm onCancel={onClose} onSubmitted={onDeviceCreated} />
              </Suspense>
            ),
          }] : []),
          ...(cableEnabled ? [{
            key: "cable",
            label: "线缆任务",
            children: (
              <Suspense fallback={fallback}>
                <CableFaultForm onCancel={onClose} onSubmitted={(id) => void onFaultSubmitted(id)} />
              </Suspense>
            ),
          }] : []),
        ]}
      />
    </Modal>
  );
}
