"use client";
import { useParams } from "next/navigation";
import { CourseBuilderPage } from "../../../../components/course-builder-page";
export default function Page() { const params = useParams<{ id: string }>(); return <CourseBuilderPage courseId={params.id} />; }
