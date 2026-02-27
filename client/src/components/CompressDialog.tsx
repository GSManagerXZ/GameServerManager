import React, { useState, useEffect } from 'react'
import { Modal, Input, Select, Form, InputNumber } from 'antd'

interface CompressDialogProps {
  visible: boolean
  fileCount: number
  onConfirm: (archiveName: string, format: string, compressionLevel: number) => void
  onCancel: () => void
}

// 生成时间戳格式的文件名
const generateTimestampFileName = (): string => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  
  return `archive_${year}${month}${day}_${hours}${minutes}${seconds}`
}

export const CompressDialog: React.FC<CompressDialogProps> = ({
  visible,
  fileCount,
  onConfirm,
  onCancel
}) => {
  const [form] = Form.useForm()
  const [archiveName, setArchiveName] = useState(generateTimestampFileName())
  const [format, setFormat] = useState('zip')
  const [compressionLevel, setCompressionLevel] = useState(6)

  // 当对话框显示时，生成新的时间戳文件名
  useEffect(() => {
    if (visible) {
      const newFileName = generateTimestampFileName()
      setArchiveName(newFileName)
      form.setFieldsValue({ archiveName: newFileName })
    }
  }, [visible, form])

  const handleOk = () => {
    const finalArchiveName = archiveName.endsWith(`.${format}`) 
      ? archiveName 
      : `${archiveName}.${format}`
    onConfirm(finalArchiveName, format, compressionLevel)
    form.resetFields()
    const newFileName = generateTimestampFileName()
    setArchiveName(newFileName)
    setFormat('zip')
    setCompressionLevel(6)
  }

  const handleCancel = () => {
    onCancel()
    form.resetFields()
    const newFileName = generateTimestampFileName()
    setArchiveName(newFileName)
    setFormat('zip')
    setCompressionLevel(6)
  }

  return (
    <Modal
      title="压缩文件"
      open={visible}
      onOk={handleOk}
      onCancel={handleCancel}
      okText="压缩"
      cancelText="取消"
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          archiveName: generateTimestampFileName(),
          format: 'zip',
          compressionLevel: 6
        }}
      >
        <p className="mb-4 text-gray-600 dark:text-gray-400">
          将要压缩 {fileCount} 个项目
        </p>
        
        <Form.Item
          label="压缩文件名"
          name="archiveName"
          rules={[{ required: true, message: '请输入压缩文件名' }]}
        >
          <Input
            value={archiveName}
            onChange={(e) => setArchiveName(e.target.value)}
            placeholder="请输入压缩文件名"
            suffix={`.${format}`}
          />
        </Form.Item>
        
        <Form.Item
          label="压缩格式"
          name="format"
        >
          <Select
            value={format}
            onChange={setFormat}
            options={[
              { label: 'ZIP', value: 'zip' },
              { label: 'TAR', value: 'tar' },
              { label: 'TAR.GZ (推荐)', value: 'tar.gz' },
              { label: 'TAR.XZ (高压缩率)', value: 'tar.xz' },
              { label: '7Z (高压缩率)', value: '7z' }
            ]}
          />
        </Form.Item>
        
        <Form.Item
          label="压缩级别"
          name="compressionLevel"
          help={format === 'tar' ? '对于TAR格式，此选项无效（TAR不压缩）' : format === '7z' ? '7z格式不支持自定义压缩级别' : '1-9，数字越大压缩率越高但速度越慢'}
        >
          <InputNumber
            min={1}
            max={9}
            value={compressionLevel}
            onChange={(value) => setCompressionLevel(value || 6)}
            className="w-full"
            disabled={format === '7z' || format === 'tar'}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}