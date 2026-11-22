/** 提供搜索和聊天页面共用的重排方式选择框。 */

import { Select } from 'antd'
import type { SelectProps } from 'antd'
import type { RerankMethod } from '../api/search'

/**
 * 透传 value、onChange 和 disabled 等属性。
 *
 * Ant Design Form 可以直接控制此组件的值，
 * 选择框无需再维护一份独立状态。
 */
export default function RerankSelect(
  props: SelectProps<RerankMethod>,
) {
  return (
    <Select<RerankMethod>
      style={{ minWidth: 220 }}
      options={[
        { value: 'rule', label: '规则重排' },
        { value: 'model', label: '模型重排' },
      ]}
      {...props}
    />
  )
}