'use client'

type MonitoringData = {
  liveActivity: {
    photosToday: number
    cameraImportsToday: number
    uploadsLastHour: number
    cameraImportsLastHour: number
  }

  throughput: {
    photoJobsLastHour: number
    faceJobsLastHour: number
    totalJobsLastHour: number
  }

  slowJobs: {
    id: string
    type: string
    seconds: number
    status: string
  }[]

  queueHeatmap: {
    photo: Record<string, number>
    face: Record<string, number>
    camera: Record<string, number>
  }
}

function Metric({
  title,
  value,
}: {
  title: string
  value: number
}) {
  return (
    <div className="rounded-[20px] bg-[#FAF7F4] p-4">
      <p className="text-[11px] font-black uppercase text-[#8E8E93]">
        {title}
      </p>

      <p className="mt-2 text-[28px] font-black text-[#1C0617]">
        {value}
      </p>
    </div>
  )
}

export default function MonitoringOverviewCard({
  data,
}: {
  data?: MonitoringData | null
}) {

      if (!data) {
    return null
  }
  return (
    <div className="rounded-[30px] border border-black/5 bg-white p-6 shadow-sm">

      <div className="mb-5">
        <p className="text-[12px] font-black uppercase tracking-[0.14em] text-[#8E8E93]">
          Monitoring
        </p>

        <h2 className="mt-1 text-[28px] font-black text-[#1C0617]">
          Live Production
        </h2>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Metric
          title="Uploads Today"
          value={data.liveActivity.photosToday}
        />

        <Metric
          title="Camera Today"
          value={data.liveActivity.cameraImportsToday}
        />

        <Metric
          title="Jobs / Hour"
          value={data.throughput.totalJobsLastHour}
        />

        <Metric
          title="Slow Jobs"
          value={data.slowJobs.length}
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">

        <div className="rounded-[22px] bg-[#FAF7F4] p-4">
          <p className="font-black">
            Photo Queue
          </p>

          <pre className="mt-3 text-xs">
            {JSON.stringify(data.queueHeatmap.photo, null, 2)}
          </pre>
        </div>

        <div className="rounded-[22px] bg-[#FAF7F4] p-4">
          <p className="font-black">
            Face Queue
          </p>

          <pre className="mt-3 text-xs">
            {JSON.stringify(data.queueHeatmap.face, null, 2)}
          </pre>
        </div>

        <div className="rounded-[22px] bg-[#FAF7F4] p-4">
          <p className="font-black">
            Camera Queue
          </p>

          <pre className="mt-3 text-xs">
            {JSON.stringify(data.queueHeatmap.camera, null, 2)}
          </pre>
        </div>

      </div>
    </div>
  )
}