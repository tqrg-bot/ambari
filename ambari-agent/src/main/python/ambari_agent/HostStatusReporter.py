'''
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
'''

import logging
import threading

from ambari_agent import Constants
from ambari_agent.HostInfo import HostInfo
from ambari_agent.Utils import Utils
from ambari_agent.Hardware import Hardware
from ambari_stomp.adapter.websocket import ConnectionIsAlreadyClosed

logger = logging.getLogger(__name__)

class HostStatusReporter(threading.Thread):
  """
  The thread reports host status to server if it changed from previous report every 'host_status_report_interval' seconds.
  """
  def __init__(self, initializer_module):
    self.initializer_module = initializer_module
    self.report_interval = initializer_module.config.host_status_report_interval
    self.stop_event = initializer_module.stop_event
    self.config = initializer_module.config
    self.host_info = HostInfo(initializer_module.config)
    self.last_report = {}
    threading.Thread.__init__(self)

  def run(self):
    while not self.stop_event.is_set():
      try:
        if self.initializer_module.is_registered:
          report = self.get_report()

          if self.initializer_module.is_registered and not Utils.are_dicts_equal(report, self.last_report, keys_to_skip=["agentTimeStampAtReporting"]):
            self.initializer_module.connection.send(message=report, destination=Constants.HOST_STATUS_REPORTS_ENDPOINT)
            self.last_report = report

        # don't use else to avoid race condition
        if not self.initializer_module.is_registered:
          self.last_report = {}
      except ConnectionIsAlreadyClosed: # server and agent disconnected during sending data. Not an issue
        pass
      except:
        logger.exception("Exception in HostStatusReporter. Re-running it")

      self.stop_event.wait(self.report_interval)

    logger.info("HostStatusReporter has successfully finished")

  def get_report(self):
    host_info_dict = {}
    self.host_info.register(host_info_dict)

    report = {
      'agentEnv': host_info_dict,
      'mounts': Hardware.osdisks(self.config),
    }

    return report