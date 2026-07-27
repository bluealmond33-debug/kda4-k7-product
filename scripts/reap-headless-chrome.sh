#!/bin/sh
# 고아 헤드리스 크롬 수거 — 스크린샷 도구가 남기고 간 것들만 골라 죽인다.
#
# 왜 필요한가: 헤드리스 크롬은 띄운 스크립트가 죽어도 같이 죽지 않는다. 부모를 잃으면
# launchd(PID 1)에 입양돼 영원히 산다. 그 상태의 GPU 프로세스는 할 일이 없는데도
# 코어 3개를 돌린다 — 실측으로 300%를 쓰며 12시간 넘게 살아 있던 트리가 있었다.
# 맥북 에어는 팬이 없어 이게 바로 발열과 스로틀링으로 온다.
#
# 무엇만 죽이는가 — 두 조건을 **모두** 만족하는 것만:
#   1) --user-data-dir 가 /tmp/cdp* (스크린샷 도구가 쓰는 임시 프로파일)
#   2) 부모가 PID 1 (= 띄운 스크립트가 이미 죽었다 = 고아)
# 사용자가 쓰는 진짜 브라우저는 임시 프로파일을 쓰지 않고 부모도 1이 아니므로
# 절대 걸리지 않는다. 다른 창이 **지금 찍고 있는** 크롬도 부모가 살아 있어 건너뛴다.
#
# 사용: sh scripts/reap-headless-chrome.sh          (조용히 수거)
#       sh scripts/reap-headless-chrome.sh -v       (무엇을 죽였는지 출력)

VERBOSE=0
[ "$1" = "-v" ] && VERBOSE=1
say() { [ "$VERBOSE" = "1" ] && echo "$@"; }

killed=0

# 1) 고아 부모 브라우저를 트리째 — 부모만 죽이면 크롬이 자식을 즉시 되살린다.
#    (실측: GPU 프로세스만 죽였더니 5초 만에 새로 떠서 다시 300%를 썼다.)
for pid in $(ps -Ao pid,ppid,args | grep "MacOS/Google Chrome" | grep -v Helper | grep -- "--user-data-dir=/tmp/cdp" | grep -v grep | awk '$2 == 1 { print $1 }'); do
  kids=$(pgrep -P "$pid" | tr '\n' ' ')
  say "트리 수거: 부모 $pid + 자식 $(echo $kids | wc -w | tr -d ' ')개"
  # 자식을 먼저 — 부모가 살아 있는 동안 죽여야 되살리기 경합이 없다
  [ -n "$kids" ] && kill -9 $kids 2>/dev/null
  kill -9 "$pid" 2>/dev/null
  killed=$((killed + 1))
done

# 2) 부모를 잃고 떠도는 헬퍼(GPU·렌더러) — 위에서 트리를 걷어내면 보통 같이 가지만,
#    부모가 먼저 죽어 이미 입양된 것들이 남는다.
sleep 1
orphan_helpers=$(ps -Ao pid,ppid,args | grep "Google Chrome" | grep -- "--user-data-dir=/tmp/cdp" | grep -v grep | awk '$2 == 1 { print $1 }')
if [ -n "$orphan_helpers" ]; then
  say "고아 헬퍼 $(echo $orphan_helpers | wc -w | tr -d ' ')개 수거"
  kill -9 $orphan_helpers 2>/dev/null
  killed=$((killed + 1))
fi

# 3) 주인 없는 임시 프로파일 디렉터리.
#
# 프로세스만 거두면 디스크가 샌다: 크롬은 뜰 때마다 새 프로파일(cdp-a4, cdp-auth2 …)에
# 캐시를 쌓고, 개당 70~150MB가 남는다. 실측으로 37개 4.2GB가 쌓여 있었다.
#
# 판정은 **날짜가 아니라 사용 여부**로 한다. 처음엔 -mtime +1(하루 지난 것)로 뒀는데,
# 세션들이 몇 분 간격으로 새 프로파일을 만들어서 하루를 못 넘기고 계속 늘기만 했다.
# 지금 크롬이 --user-data-dir로 물고 있는 것만 남기고 나머지는 지운다 —
# 크롬이 죽은 순간 그 프로파일은 두 번 다시 쓰이지 않는다(매번 새 이름으로 뜬다).
inuse=$(ps -Ao args | grep "Google Chrome" | grep -oE "user-data-dir=/tmp/cdp-[A-Za-z0-9_-]+" | sed 's|.*/tmp/||' | sort -u)
for dir in /tmp/cdp-*; do
  [ -d "$dir" ] || continue
  name=$(basename "$dir")
  echo "$inuse" | grep -qx "$name" && { say "프로파일 유지: $name (사용 중)"; continue; }
  say "프로파일 삭제: $name ($(du -sh "$dir" 2>/dev/null | cut -f1))"
  rm -rf "$dir" 2>/dev/null
done

if [ "$killed" = "0" ]; then
  say "수거할 고아 없음"
else
  say "완료 — 크롬 CPU 합계: $(ps -Ao pcpu,args | grep 'Google Chrome' | grep -v grep | awk '{s+=$1} END {printf "%.0f%%", s}')"
fi
exit 0
