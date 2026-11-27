import WidgetKit
import SwiftUI

// The app writes the next 7 days (level, headline, best / careful areas) into the shared
// app group, so the widget keeps working at midnight without opening the app.
struct DayInfo: Codable {
    let d: String      // yyyy-MM-dd
    let lv: String     // 旺 / 平 / 煩 / 忌
    let h: String      // one-line headline
    let s: Double      // 0–5
    let up: String     // best area
    let care: String   // area to watch
}

struct DayEntry: TimelineEntry {
    let date: Date
    let day: DayInfo?
}

private let group = "group.app.soluna.ios"
private func key(_ date: Date) -> String {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: date)
}
private func loadDays() -> [DayInfo] {
    guard let s = UserDefaults(suiteName: group)?.string(forKey: "days"), let data = s.data(using: .utf8) else { return [] }
    return (try? JSONDecoder().decode([DayInfo].self, from: data)) ?? []
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> DayEntry {
        DayEntry(date: Date(), day: DayInfo(d: key(Date()), lv: "平", h: "慢慢嚟，今日會順。", s: 3.2, up: "事業", care: ""))
    }
    func getSnapshot(in context: Context, completion: @escaping (DayEntry) -> Void) {
        let days = loadDays()
        completion(DayEntry(date: Date(), day: days.first { $0.d == key(Date()) } ?? placeholder(in: context).day))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<DayEntry>) -> Void) {
        let days = loadDays(), cal = Calendar.current
        var entries = [DayEntry(date: Date(), day: days.first { $0.d == key(Date()) })]
        var midnight = cal.startOfDay(for: Date())
        for _ in 0..<7 {
            midnight = cal.date(byAdding: .day, value: 1, to: midnight)!
            entries.append(DayEntry(date: midnight, day: days.first { $0.d == key(midnight) }))
        }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

struct Palette {
    let bg: Color, fg: Color, mute: Color, accent: Color
    static func of(_ scheme: ColorScheme) -> Palette {
        scheme == .dark
            ? Palette(bg: Color(red: 0.05, green: 0.04, blue: 0.08), fg: Color(red: 0.93, green: 0.92, blue: 1.0), mute: Color(red: 0.62, green: 0.61, blue: 0.75), accent: Color(red: 0.79, green: 0.78, blue: 0.96))
            : Palette(bg: Color(red: 0.97, green: 0.95, blue: 0.90), fg: Color(red: 0.16, green: 0.13, blue: 0.10), mute: Color(red: 0.45, green: 0.40, blue: 0.33), accent: Color(red: 0.66, green: 0.48, blue: 0.20))
    }
}

struct SolunaWidgetView: View {
    var entry: Provider.Entry
    @Environment(\.colorScheme) var scheme
    @Environment(\.widgetFamily) var family

    var dateLine: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "zh_Hant_HK")
        f.dateFormat = "M月d日 EEE"
        return f.string(from: entry.date)
    }

    var body: some View {
        let p = Palette.of(scheme)
        let content = VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("曜 SOLUNA").font(.system(size: 10, weight: .light)).tracking(2).foregroundColor(p.mute)
                Spacer()
                Text(dateLine).font(.system(size: 10, weight: .light)).foregroundColor(p.mute)
            }
            if let d = entry.day {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(d.lv).font(.system(size: family == .systemSmall ? 40 : 44, weight: .light, design: .serif)).foregroundColor(p.accent)
                    if family != .systemSmall {
                        Text(String(format: "%.1f / 5", d.s)).font(.system(size: 12, weight: .light, design: .monospaced)).foregroundColor(p.mute)
                    }
                }
                Text(d.h).font(.system(size: 13, weight: .regular, design: .serif)).foregroundColor(p.fg).lineLimit(family == .systemSmall ? 3 : 2)
                if family != .systemSmall {
                    Spacer(minLength: 2)
                    HStack(spacing: 14) {
                        if !d.up.isEmpty { Label("旺 · \(d.up)", systemImage: "sparkle").font(.system(size: 11)).foregroundColor(p.fg) }
                        if !d.care.isEmpty { Label("留神 · \(d.care)", systemImage: "moon").font(.system(size: 11)).foregroundColor(p.mute) }
                    }
                }
            } else {
                Spacer()
                Text("打開 Soluna，睇你今日嘅星空。").font(.system(size: 13, design: .serif)).foregroundColor(p.fg)
                Spacer()
            }
        }
        .widgetURL(URL(string: "soluna://today"))

        if #available(iOS 17.0, *) {
            content.containerBackground(for: .widget) { p.bg }
        } else {
            content.padding(14).background(p.bg)
        }
    }
}

@main
struct SolunaWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SolunaToday", provider: Provider()) { entry in
            SolunaWidgetView(entry: entry)
        }
        .configurationDisplayName("今日運勢")
        .description("每日嘅旺平煩忌同一句提醒。")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
